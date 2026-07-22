// ─── Shared supplier / customer / doctor importers for the migration wizard ──
// Shared so the upsert + dedup behaviour lives in exactly one place (mirrors
// migration-inventory.ts). Rows are upserted one at a time (independent commits)
// to preserve per-row partial-success semantics and correct case-insensitive
// natural-key matching; large files are kept off the request path by the
// caller dispatching to a background job, not by batching here.

import type { Db } from "./client.js";

export interface EntityImportIssue {
  row:      number;
  field?:   string;
  message:  string;
  severity: "error" | "warning";
}

export interface EntityImportOutcome {
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  failedRows:  number;
  issues:      EntityImportIssue[];
}

// Input shapes — structurally match the Validated*Row types from @pharmacy/utils.
export interface SupplierUpsertRow {
  rowNumber: number; supplierName: string;
  gstin?: string; dlNumber?: string; phone?: string; email?: string;
  address?: string; city?: string; state?: string; creditDays?: number; openingBalance?: number;
}
export interface CustomerUpsertRow {
  rowNumber: number; customerName: string;
  phone?: string; email?: string; address?: string; dateOfBirth?: string;
  gender?: string; creditLimit?: number; openingDue?: number;
  abhaNumber?: string; cardNumber?: string; notes?: string;
}
export interface DoctorUpsertRow {
  rowNumber: number; doctorName: string;
  registrationNo?: string; specialty?: string; clinic?: string; phone?: string; email?: string;
}

const CHECKPOINT_EVERY = 100;

// ── Suppliers ─────────────────────────────────────────────────────────────────

export async function importResolvedSuppliers(
  db: Db,
  params: { sessionId: string; pharmacyId: string; rows: SupplierUpsertRow[]; onCheckpoint?: (processed: number) => Promise<void> },
): Promise<EntityImportOutcome> {
  const { sessionId, pharmacyId, rows, onCheckpoint } = params;
  const issues: EntityImportIssue[] = [];
  let createdRows = 0, updatedRows = 0, skippedRows = 0, failedRows = 0;

  // Dedup key: a non-blank GSTIN identifies a supplier; otherwise fall back to
  // the lowercased name. Blank identifiers never collapse two distinct rows.
  const seen = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const key = r.gstin ? `gstin:${r.gstin}` : `name:${r.supplierName.toLowerCase()}`;
    const firstRow = seen.get(key);
    if (firstRow !== undefined) {
      skippedRows++;
      issues.push({ row: r.rowNumber, field: r.gstin ? "gstin" : "supplierName", message: `Duplicate of row ${firstRow} in this file (same ${r.gstin ? "GSTIN" : "name"}) — skipped to avoid merging distinct records`, severity: "warning" });
      continue;
    }
    seen.set(key, r.rowNumber);

    try {
      const existing = await db.supplier.findFirst({
        where: { pharmacyId, OR: [{ name: { equals: r.supplierName, mode: "insensitive" } }, ...(r.gstin ? [{ gstin: r.gstin }] : [])] },
        select: { id: true },
      });

      if (existing) {
        await db.supplier.update({
          where: { id: existing.id },
          data: {
            gstin: r.gstin ?? undefined, dlNumber: r.dlNumber ?? undefined,
            phone: r.phone ?? undefined, email: r.email ?? undefined,
            address: r.address ?? undefined, city: r.city ?? undefined, state: r.state ?? undefined,
            creditDays: r.creditDays ?? undefined,
            ...(r.openingBalance != null ? { ledgerBalance: r.openingBalance } : {}),
          },
        });
        updatedRows++;
      } else {
        const created = await db.supplier.create({
          data: {
            pharmacyId, name: r.supplierName, gstin: r.gstin, dlNumber: r.dlNumber,
            phone: r.phone, email: r.email, address: r.address, city: r.city, state: r.state,
            creditDays: r.creditDays ?? 30, ledgerBalance: r.openingBalance ?? 0,
          },
          select: { id: true },
        });
        await db.migrationCreatedRecord.create({ data: { sessionId, entityType: "SUPPLIERS", entityId: created.id } });
        createdRows++;
      }
    } catch {
      issues.push({ row: r.rowNumber, message: `Could not import supplier "${r.supplierName}" — please retry`, severity: "error" });
      failedRows++;
    }

    if (onCheckpoint && (i + 1) % CHECKPOINT_EVERY === 0) await onCheckpoint(i + 1).catch(() => {});
  }

  return { createdRows, updatedRows, skippedRows, failedRows, issues };
}

// ── Customers ─────────────────────────────────────────────────────────────────

export async function importResolvedCustomers(
  db: Db,
  params: { sessionId: string; pharmacyId: string; userId: string; rows: CustomerUpsertRow[]; onCheckpoint?: (processed: number) => Promise<void> },
): Promise<EntityImportOutcome> {
  const { sessionId, pharmacyId, userId, rows, onCheckpoint } = params;
  const issues: EntityImportIssue[] = [];
  let createdRows = 0, updatedRows = 0, skippedRows = 0, failedRows = 0;

  // Phone is the reliable identifier; fall back to lowercased name when absent.
  const seen = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const key = r.phone ? `phone:${r.phone}` : `name:${r.customerName.toLowerCase()}`;
    const firstRow = seen.get(key);
    if (firstRow !== undefined) {
      skippedRows++;
      issues.push({ row: r.rowNumber, field: r.phone ? "phone" : "customerName", message: `Duplicate of row ${firstRow} in this file (same ${r.phone ? "phone" : "name"}) — skipped to avoid merging distinct records`, severity: "warning" });
      continue;
    }
    seen.set(key, r.rowNumber);

    try {
      const existing = r.phone
        ? await db.customer.findFirst({ where: { pharmacyId, phone: r.phone, deletedAt: null }, select: { id: true } })
        : await db.customer.findFirst({ where: { pharmacyId, name: { equals: r.customerName, mode: "insensitive" }, deletedAt: null }, select: { id: true } });

      if (existing) {
        await db.customer.update({
          where: { id: existing.id },
          data: {
            email: r.email ?? undefined, address: r.address ?? undefined,
            dateOfBirth: r.dateOfBirth ? new Date(r.dateOfBirth) : undefined,
            gender: r.gender ?? undefined, creditLimit: r.creditLimit ?? undefined,
            // creditUsed tracks real unpaid invoices — never overwrite from an import.
            abhaNumber: r.abhaNumber ?? undefined, notes: r.notes ?? undefined,
          },
        });
        updatedRows++;
      } else {
        const created = await db.customer.create({
          data: {
            pharmacyId, name: r.customerName, phone: r.phone, email: r.email, address: r.address,
            dateOfBirth: r.dateOfBirth ? new Date(r.dateOfBirth) : undefined, gender: r.gender,
            creditLimit: r.creditLimit ?? 0, creditUsed: r.openingDue ?? 0,
            abhaNumber: r.abhaNumber, cardNumber: r.cardNumber, notes: r.notes,
            customerType: r.creditLimit && r.creditLimit > 0 ? "CREDIT" : "WALK_IN",
            createdById: userId,
          },
          select: { id: true },
        });
        await db.migrationCreatedRecord.create({ data: { sessionId, entityType: "CUSTOMERS", entityId: created.id } });
        createdRows++;
      }
    } catch {
      issues.push({ row: r.rowNumber, message: `Could not import customer "${r.customerName}" — please retry`, severity: "error" });
      failedRows++;
    }

    if (onCheckpoint && (i + 1) % CHECKPOINT_EVERY === 0) await onCheckpoint(i + 1).catch(() => {});
  }

  return { createdRows, updatedRows, skippedRows, failedRows, issues };
}

// ── Doctors ───────────────────────────────────────────────────────────────────

export async function importResolvedDoctors(
  db: Db,
  params: { sessionId: string; pharmacyId: string; rows: DoctorUpsertRow[]; onCheckpoint?: (processed: number) => Promise<void> },
): Promise<EntityImportOutcome> {
  const { sessionId, pharmacyId, rows, onCheckpoint } = params;
  const issues: EntityImportIssue[] = [];
  let createdRows = 0, updatedRows = 0, skippedRows = 0, failedRows = 0;

  const seen = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const key = r.registrationNo ? `reg:${r.registrationNo}` : `name:${r.doctorName.toLowerCase()}`;
    const firstRow = seen.get(key);
    if (firstRow !== undefined) {
      skippedRows++;
      issues.push({ row: r.rowNumber, field: r.registrationNo ? "registrationNo" : "doctorName", message: `Duplicate of row ${firstRow} in this file (same ${r.registrationNo ? "registration no." : "name"}) — skipped to avoid merging distinct records`, severity: "warning" });
      continue;
    }
    seen.set(key, r.rowNumber);

    try {
      const existing = r.registrationNo
        ? await db.doctor.findFirst({ where: { pharmacyId, registrationNo: r.registrationNo }, select: { id: true } })
        : await db.doctor.findFirst({ where: { pharmacyId, name: { equals: r.doctorName, mode: "insensitive" } }, select: { id: true } });

      if (existing) {
        await db.doctor.update({
          where: { id: existing.id },
          data: { specialty: r.specialty ?? undefined, clinic: r.clinic ?? undefined, phone: r.phone ?? undefined, email: r.email ?? undefined },
        });
        updatedRows++;
      } else {
        const created = await db.doctor.create({
          data: { pharmacyId, name: r.doctorName, registrationNo: r.registrationNo, specialty: r.specialty, clinic: r.clinic, phone: r.phone, email: r.email },
          select: { id: true },
        });
        await db.migrationCreatedRecord.create({ data: { sessionId, entityType: "DOCTORS", entityId: created.id } });
        createdRows++;
      }
    } catch {
      issues.push({ row: r.rowNumber, message: `Could not import doctor "${r.doctorName}" — please retry`, severity: "error" });
      failedRows++;
    }

    if (onCheckpoint && (i + 1) % CHECKPOINT_EVERY === 0) await onCheckpoint(i + 1).catch(() => {});
  }

  return { createdRows, updatedRows, skippedRows, failedRows, issues };
}
