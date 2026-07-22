// ─── Shared bulk inventory importer for the migration wizard ─────────────────
// Shared between the synchronous request path and the async background job so
// the persistence behaviour — skip-existing (no double-counting), within-file
// dedup, bulk insert, and per-row fallback — lives in exactly one place.
//
// Callers are responsible for parsing + validating rows and resolving each
// row's medicineId (creating catalog entries as needed). This helper only
// persists already-resolved batches.

import type { Db } from "./client.js";
import { withTenant } from "./client.js";

export interface ResolvedInventoryRow {
  rowNumber:     number;
  medicineId:    string;
  medicineName:  string; // for error messages only
  batchNumber:   string;
  expiryDate:    string; // ISO
  quantity:      number;
  purchaseRate:  number;
  mrp:           number;
  minimumStock?: number;
}

export interface InventoryImportIssue {
  row:      number;
  field?:   string;
  message:  string;
  severity: "error" | "warning";
}

export interface InventoryImportOutcome {
  successRows: number;
  skippedRows: number;
  failedRows:  number;
  issues:      InventoryImportIssue[];
}

// Insert in chunks so a single createMany statement never gets pathologically
// large on a big migration file.
const INSERT_CHUNK = 500;

const batchKey = (medicineId: string, batchNumber: string) => `${medicineId}|${batchNumber}`;

/**
 * Persists pre-resolved inventory batches for a migration session.
 *
 * Behaviour:
 *  - A batch that already exists (same pharmacy + medicine + batch number) is
 *    SKIPPED with a warning, never incremented — so re-importing the same file
 *    can't silently double stock.
 *  - Duplicate (medicine, batch) rows within the same file are collapsed to the
 *    first occurrence (subsequent ones skipped with a warning).
 *  - New batches are bulk-inserted; only new batches are tracked for rollback.
 *  - If a bulk chunk fails, it's retried row-by-row so good rows still commit
 *    and only genuinely-bad rows are reported as failed.
 */
export async function importResolvedInventory(
  db: Db,
  params: {
    sessionId:     string;
    pharmacyId:    string;
    userId:        string;
    rows:          ResolvedInventoryRow[];
    onCheckpoint?: (processed: number, success: number, failed: number) => Promise<void>;
  },
): Promise<InventoryImportOutcome> {
  const { sessionId, pharmacyId, userId, rows, onCheckpoint } = params;
  const issues: InventoryImportIssue[] = [];
  let successRows = 0;
  let skippedRows = 0;
  let failedRows  = 0;

  if (rows.length === 0) return { successRows, skippedRows, failedRows, issues };

  // 1. Preload every already-existing batch for the medicines in this file — one query.
  const existing = await db.inventory.findMany({
    where:  { pharmacyId, OR: rows.map((r) => ({ medicineId: r.medicineId, batchNumber: r.batchNumber })) },
    select: { medicineId: true, batchNumber: true },
  });
  const existingSet = new Set(existing.map((e) => batchKey(e.medicineId, e.batchNumber)));

  // 2. Partition into insert vs skip (existing on DB, or duplicate within this file).
  const seen = new Set<string>();
  const toInsert: ResolvedInventoryRow[] = [];
  for (const r of rows) {
    const key = batchKey(r.medicineId, r.batchNumber);
    if (existingSet.has(key) || seen.has(key)) {
      skippedRows++;
      issues.push({
        row:      r.rowNumber,
        field:    "batchNumber",
        message:  `Batch "${r.batchNumber}" already exists for "${r.medicineName}" — skipped to avoid double-counting stock`,
        severity: "warning",
      });
      continue;
    }
    seen.add(key);
    toInsert.push(r);
  }

  // 3. Bulk-insert new batches in chunks, inside a tenant-scoped transaction.
  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
    const chunk = toInsert.slice(i, i + INSERT_CHUNK);
    try {
      await withTenant(db, pharmacyId, async (tx) => {
        await tx.inventory.createMany({
          data: chunk.map((r) => ({
            pharmacyId,
            medicineId:   r.medicineId,
            batchNumber:  r.batchNumber,
            expiryDate:   new Date(r.expiryDate),
            quantity:     r.quantity,
            purchaseRate: r.purchaseRate,
            mrp:          r.mrp,
            minimumStock: r.minimumStock ?? 10,
            reorderLevel: 5,
            status:       "ACTIVE",
          })),
          skipDuplicates: true, // belt-and-suspenders against a concurrent insert
        });

        // Fetch the ids of the just-inserted batches to hang movements + tracking off.
        const created = await tx.inventory.findMany({
          where:  { pharmacyId, OR: chunk.map((r) => ({ medicineId: r.medicineId, batchNumber: r.batchNumber })) },
          select: { id: true, medicineId: true, batchNumber: true },
        });
        const idMap = new Map(created.map((c) => [batchKey(c.medicineId, c.batchNumber), c.id]));

        const movements = [];
        const records   = [];
        for (const r of chunk) {
          const invId = idMap.get(batchKey(r.medicineId, r.batchNumber));
          if (!invId) continue;
          movements.push({
            pharmacyId,
            inventoryId:    invId,
            userId,
            type:           "OPENING" as const,
            direction:      "IN" as const,
            quantity:       r.quantity,
            quantityBefore: 0, // always a brand-new batch here (existing ones were skipped)
            quantityAfter:  r.quantity,
            referenceType:  "OPENING_BALANCE" as const,
            referenceId:    sessionId,
            notes:          "Imported via migration wizard",
          });
          records.push({ sessionId, entityType: "INVENTORY" as const, entityId: invId });
        }
        if (movements.length) await tx.inventoryMovement.createMany({ data: movements });
        if (records.length)   await tx.migrationCreatedRecord.createMany({ data: records });
      });

      successRows += chunk.length;
    } catch {
      // Bulk chunk failed — retry row by row so good rows still land.
      const fallback = await importChunkRowByRow(db, { sessionId, pharmacyId, userId, chunk });
      successRows += fallback.success;
      failedRows  += fallback.failed;
      issues.push(...fallback.issues);
    }

    if (onCheckpoint) {
      await onCheckpoint(Math.min(i + INSERT_CHUNK, toInsert.length) + skippedRows, successRows, failedRows).catch(() => {});
    }
  }

  return { successRows, skippedRows, failedRows, issues };
}

// Per-row fallback used only when a bulk chunk throws.
async function importChunkRowByRow(
  db: Db,
  params: { sessionId: string; pharmacyId: string; userId: string; chunk: ResolvedInventoryRow[] },
): Promise<{ success: number; failed: number; issues: InventoryImportIssue[] }> {
  const { sessionId, pharmacyId, userId, chunk } = params;
  const issues: InventoryImportIssue[] = [];
  let success = 0;
  let failed  = 0;

  for (const r of chunk) {
    try {
      const didInsert = await withTenant(db, pharmacyId, async (tx) => {
        // Skip if it now exists (e.g. inserted by a concurrent import between preload and here).
        const prior = await tx.inventory.findUnique({
          where:  { pharmacyId_medicineId_batchNumber: { pharmacyId, medicineId: r.medicineId, batchNumber: r.batchNumber } },
          select: { id: true },
        });
        if (prior) return false;

        const inv = await tx.inventory.create({
          data: {
            pharmacyId, medicineId: r.medicineId, batchNumber: r.batchNumber,
            expiryDate: new Date(r.expiryDate), quantity: r.quantity,
            purchaseRate: r.purchaseRate, mrp: r.mrp,
            minimumStock: r.minimumStock ?? 10, reorderLevel: 5, status: "ACTIVE",
          },
        });
        await tx.inventoryMovement.create({
          data: {
            pharmacyId, inventoryId: inv.id, userId,
            type: "OPENING", direction: "IN",
            quantity: r.quantity, quantityBefore: 0, quantityAfter: r.quantity,
            referenceType: "OPENING_BALANCE", referenceId: sessionId,
            notes: "Imported via migration wizard",
          },
        });
        await tx.migrationCreatedRecord.create({ data: { sessionId, entityType: "INVENTORY", entityId: inv.id } });
        return true;
      });

      if (didInsert) success++;
      else issues.push({ row: r.rowNumber, field: "batchNumber", message: `Batch "${r.batchNumber}" already exists for "${r.medicineName}" — skipped`, severity: "warning" });
    } catch (err: any) {
      const code = err?.code;
      const message =
        code === "P2002" ? `Batch ${r.batchNumber} already exists for this medicine`
        : code === "P2003" ? `Medicine "${r.medicineName}" no longer exists in the catalog`
        : `Row ${r.rowNumber} could not be imported — please retry`;
      issues.push({ row: r.rowNumber, message, severity: "error" });
      failed++;
    }
  }

  return { success, failed, issues };
}
