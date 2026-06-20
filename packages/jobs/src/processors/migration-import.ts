import type { Job } from "pg-boss";
import { prisma } from "@pharmacy/database";
import type { MigrationImportJobData } from "../client.js";

// ── Inlined CSV parser ────────────────────────────────────────────────────────
// Duplicated from apps/api/src/modules/migration/migration.mapper.ts
// (can't cross rootDir boundary in a monorepo without a shared package)

interface ParsedRow {
  rowNumber: number;
  fields:    Record<string, string>;
}

function splitLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current  = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim()); current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function normaliseDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split("/");
    const d = new Date(`${yyyy}-${mm}-${dd}`); return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const mmYyyy = s.match(/^(\d{2})[\/\-](\d{4})$/);
  if (mmYyyy) {
    const [, mm, yyyy] = mmYyyy;
    const d = new Date(Number(yyyy), Number(mm), 0); return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const mmYy = s.match(/^(\d{2})[\/\-](\d{2})$/);
  if (mmYy) {
    const [, mm, yy] = mmYy;
    const d = new Date(2000 + Number(yy), Number(mm), 0); return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function parseCsv(csvText: string, columnMappings: Record<string, string>): ParsedRow[] {
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n");
  if (lines.length < 2) return [];
  const headerLine = lines[0] ?? "";
  const delimiter  = (headerLine.match(/\t/g)?.length ?? 0) > (headerLine.match(/,/g)?.length ?? 0) ? "\t" : ",";
  const csvHeaders = splitLine(headerLine, delimiter);
  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (!line) continue;
    const cols: string[] = splitLine(line, delimiter);
    const fields: Record<string, string> = {};
    for (let c = 0; c < csvHeaders.length; c++) {
      const header    = csvHeaders[c] ?? "";
      const canonical = columnMappings[header];
      if (canonical && canonical !== "(skip)") fields[canonical] = (cols[c] ?? "").trim();
    }
    rows.push({ rowNumber: i + 1, fields });
  }
  return rows;
}

// ── Inlined inventory validator ───────────────────────────────────────────────

interface ValidatedRow {
  rowNumber:    number;
  medicineName: string;
  batchNumber:  string;
  expiryDate:   string;
  quantity:     number;
  mrp:          number;
  purchaseRate: number;
  gstRate:      number;
  manufacturer?: string;
  hsnCode?:     string;
  minimumStock?: number;
}

interface RowIssue { row: number; field?: string; message: string; severity: "error" | "warning" }

const VALID_GST = new Set([0, 5, 12, 18]);

function validateInventoryRow(row: ParsedRow): { data: ValidatedRow | null; issues: RowIssue[] } {
  const { rowNumber, fields } = row;
  const issues: RowIssue[] = [];

  const medicineName = (fields["medicineName"] ?? "").trim();
  const batchNumber  = (fields["batchNumber"]  ?? "").trim();
  const expiryRaw    = (fields["expiryDate"]   ?? "").trim();
  const qtyRaw       = (fields["quantity"]     ?? "").trim();
  const mrpRaw       = (fields["mrp"]          ?? "").trim();
  const rateRaw      = (fields["purchaseRate"] ?? "").trim();
  const gstRaw       = (fields["gstRate"]      ?? "12").trim();

  if (!medicineName) issues.push({ row: rowNumber, field: "medicineName", message: "Medicine name is required",  severity: "error" });
  if (!batchNumber)  issues.push({ row: rowNumber, field: "batchNumber",  message: "Batch number is required",   severity: "error" });

  const expiryDate = normaliseDate(expiryRaw);
  if      (!expiryRaw)   issues.push({ row: rowNumber, field: "expiryDate", message: "Expiry date is required",                severity: "error" });
  else if (!expiryDate)  issues.push({ row: rowNumber, field: "expiryDate", message: `Cannot parse expiry "${expiryRaw}"`,     severity: "error" });

  const quantity = parseInt(qtyRaw, 10);
  if (!qtyRaw)                            issues.push({ row: rowNumber, field: "quantity", message: "Quantity is required",        severity: "error" });
  else if (isNaN(quantity) || quantity < 0) issues.push({ row: rowNumber, field: "quantity", message: `Invalid quantity "${qtyRaw}"`, severity: "error" });

  const mrp = parseFloat(mrpRaw);
  if (!mrpRaw)                   issues.push({ row: rowNumber, field: "mrp", message: "MRP is required",           severity: "error" });
  else if (isNaN(mrp) || mrp <= 0) issues.push({ row: rowNumber, field: "mrp", message: `Invalid MRP "${mrpRaw}"`, severity: "error" });

  const purchaseRate = parseFloat(rateRaw);
  if (!rateRaw)                           issues.push({ row: rowNumber, field: "purchaseRate", message: "Purchase rate is required",            severity: "error" });
  else if (isNaN(purchaseRate) || purchaseRate <= 0) issues.push({ row: rowNumber, field: "purchaseRate", message: `Invalid purchase rate "${rateRaw}"`, severity: "error" });

  const gstRate = parseFloat(gstRaw || "12");

  if (issues.some((i) => i.severity === "error") || !expiryDate) return { data: null, issues };

  const minimumStockRaw = (fields["minimumStock"] ?? "").trim();
  const minimumStock    = minimumStockRaw ? parseInt(minimumStockRaw, 10) : undefined;

  return {
    data: {
      rowNumber,
      medicineName,
      batchNumber,
      expiryDate,
      quantity:     isNaN(quantity)     ? 0  : quantity,
      mrp:          isNaN(mrp)          ? 0  : mrp,
      purchaseRate: isNaN(purchaseRate) ? 0  : purchaseRate,
      gstRate:      VALID_GST.has(gstRate) ? gstRate : 12,
      manufacturer: (fields["manufacturer"] ?? "").trim() || undefined,
      hsnCode:      (fields["hsnCode"]      ?? "").trim() || undefined,
      minimumStock: minimumStock && !isNaN(minimumStock) ? minimumStock : undefined,
    },
    issues,
  };
}

// ── Job handler ───────────────────────────────────────────────────────────────

export async function migrationImportHandler(jobs: Job<MigrationImportJobData>[]): Promise<void> {
  for (const job of jobs) {
    const { jobId, sessionId, pharmacyId, userId, entityType, csvText, columnMappings } = job.data;

    try {
      await prisma.migrationImportJob.update({
        where: { id: jobId },
        data:  { status: "PROCESSING", startedAt: new Date() },
      });

      if (entityType === "INVENTORY") {
        await processInventoryImport(jobId, sessionId, pharmacyId, userId, csvText, columnMappings);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.migrationImportJob.update({
        where: { id: jobId },
        data: {
          status:      "FAILED",
          completedAt: new Date(),
          errors:      [{ row: 0, message: `Job failed: ${message}`, severity: "error" }] as any,
        },
      }).catch(() => {});
    }
  }
}

async function processInventoryImport(
  jobId:          string,
  sessionId:      string,
  pharmacyId:     string,
  userId:         string,
  csvText:        string,
  columnMappings: Record<string, string>,
) {
  const rows = parseCsv(csvText, columnMappings);

  const medicineMappings = await prisma.medicineMapping.findMany({ where: { pharmacyId } });
  const mappingLookup    = new Map(medicineMappings.map((m) => [m.csvValue, m]));

  let successRows = 0;
  let failedRows  = 0;
  const errors: RowIssue[] = [];

  const BATCH_SIZE = 50;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      const { data, issues } = validateInventoryRow(row);
      const rowErrors = issues.filter((x) => x.severity === "error");

      if (!data || rowErrors.length > 0) {
        errors.push(...rowErrors);
        failedRows++;
        continue;
      }

      const csvKey  = data.medicineName.toLowerCase().trim();
      const mapping = mappingLookup.get(csvKey);

      if (!mapping) {
        errors.push({ row: data.rowNumber, field: "medicineName", message: `No medicine mapping confirmed for "${data.medicineName}" — complete the medicine mapping step first`, severity: "error" });
        failedRows++;
        continue;
      }

      // Resolve medicineId — may need to create the medicine if user chose "Create New"
      let resolvedMedicineId = mapping.medicineId;

      if (mapping.isNew && !resolvedMedicineId) {
        try {
          const existingMed = await prisma.medicine.findFirst({
            where: { name: { equals: data.medicineName, mode: "insensitive" } },
          });
          if (existingMed) {
            resolvedMedicineId = existingMed.id;
          } else {
            const created = await prisma.medicine.create({
              data: {
                name:         data.medicineName,
                manufacturer: data.manufacturer,
                hsnCode:      data.hsnCode,
                gstRate:      data.gstRate,
              },
            });
            resolvedMedicineId = created.id;
            await prisma.migrationCreatedRecord.create({
              data: { sessionId, entityType: "MEDICINE", entityId: created.id },
            });
            // Update mapping so future rows reuse the same medicine ID
            await prisma.medicineMapping.updateMany({
              where: { pharmacyId, csvValue: csvKey },
              data:  { medicineId: created.id },
            });
            mappingLookup.set(csvKey, { ...mapping, medicineId: created.id });
          }
        } catch (err: any) {
          errors.push({ row: data.rowNumber, field: "medicineName", message: `Failed to create medicine "${data.medicineName}": ${err?.message ?? "unknown"}`, severity: "error" });
          failedRows++;
          continue;
        }
      }

      if (!resolvedMedicineId) {
        errors.push({ row: data.rowNumber, field: "medicineName", message: `Medicine mapping for "${data.medicineName}" has no catalog ID`, severity: "error" });
        failedRows++;
        continue;
      }

      try {
        const priorBatch = await prisma.inventory.findUnique({
          where: {
            pharmacyId_medicineId_batchNumber: {
              pharmacyId, medicineId: resolvedMedicineId, batchNumber: data.batchNumber,
            },
          },
          select: { id: true, quantity: true },
        });

        const inv = await prisma.inventory.upsert({
          where: {
            pharmacyId_medicineId_batchNumber: {
              pharmacyId, medicineId: resolvedMedicineId, batchNumber: data.batchNumber,
            },
          },
          update: {
            quantity:     { increment: data.quantity },
            purchaseRate: data.purchaseRate,
            mrp:          data.mrp,
          },
          create: {
            pharmacyId,
            medicineId:   resolvedMedicineId,
            batchNumber:  data.batchNumber,
            expiryDate:   new Date(data.expiryDate),
            quantity:     data.quantity,
            purchaseRate: data.purchaseRate,
            mrp:          data.mrp,
            minimumStock: data.minimumStock ?? 10,
            reorderLevel: 5,
            status:       "ACTIVE",
          },
        });

        const qtyBefore = priorBatch?.quantity ?? 0;
        await prisma.inventoryMovement.create({
          data: {
            pharmacyId,
            inventoryId:    inv.id,
            userId,
            type:           "OPENING",
            direction:      "IN",
            quantity:       data.quantity,
            quantityBefore: qtyBefore,
            quantityAfter:  qtyBefore + data.quantity,
            referenceType:  "OPENING_BALANCE",
            referenceId:    sessionId,
            notes:          "Async migration import",
          },
        });

        // Only track NEW batches for rollback — don't track pre-existing batch updates.
        if (!priorBatch) {
          await prisma.migrationCreatedRecord.create({
            data: { sessionId, entityType: "INVENTORY", entityId: inv.id },
          });
        }

        successRows++;
      } catch {
        errors.push({ row: data.rowNumber, message: `Failed to import row ${data.rowNumber}`, severity: "error" });
        failedRows++;
      }
    }

    // Checkpoint progress after every batch
    await prisma.migrationImportJob.update({
      where: { id: jobId },
      data:  { processedRows: Math.min(i + BATCH_SIZE, rows.length), successRows, failedRows },
    });
  }

  const finalStatus = successRows === 0 ? "FAILED" : "COMPLETED";

  await prisma.migrationImportJob.update({
    where: { id: jobId },
    data: {
      status:       finalStatus,
      processedRows: rows.length,
      successRows,
      failedRows,
      errors:       errors as any,
      completedAt:  new Date(),
    },
  });

  if (successRows > 0) {
    const session = await prisma.migrationSession.findUnique({ where: { id: sessionId } });
    if (session) {
      const steps = new Set(session.completedSteps);
      steps.add("inventory");
      await prisma.migrationSession.update({
        where: { id: sessionId },
        data:  { completedSteps: [...steps] },
      });
    }
  }
}
