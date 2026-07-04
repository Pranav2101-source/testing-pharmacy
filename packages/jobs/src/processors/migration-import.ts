import type { Job } from "pg-boss";
import {
  prisma,
  importResolvedInventory,
  importResolvedSuppliers,
  importResolvedCustomers,
  importResolvedDoctors,
  type ResolvedInventoryRow,
  type InventoryImportIssue,
  type EntityImportIssue,
} from "@pharmacy/database";
import {
  parseCsv,
  validateInventoryRow,
  validateSupplierRow,
  validateCustomerRow,
  validateDoctorRow,
} from "@pharmacy/utils";
import type { MigrationImportJobData } from "../client.js";

// CSV parsing + row validation come from @pharmacy/utils, and the bulk insert
// (skip-existing, dedup, batched writes, per-row fallback) from
// @pharmacy/database — the same code the synchronous apps/api path uses, so the
// two can no longer drift apart.

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
      } else {
        await processEntityImport(entityType, jobId, sessionId, pharmacyId, userId, csvText, columnMappings);
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
      }).catch((e) => {
        console.error("[migration-import] Failed to mark job FAILED — job will remain stuck in PROCESSING:", jobId, e);
      });
    }
  }
}

async function failJob(jobId: string, message: string) {
  await prisma.migrationImportJob.update({
    where: { id: jobId },
    data: {
      status:      "FAILED",
      completedAt: new Date(),
      errors:      [{ row: 0, message, severity: "error" }] as any,
    },
  });
}

async function processInventoryImport(
  jobId:          string,
  sessionId:      string,
  pharmacyId:     string,
  userId:         string,
  csvText:        string,
  columnMappings: Record<string, string>,
) {
  if (!csvText?.trim()) {
    await failJob(jobId, "Import job contained no CSV data — please start the migration again");
    return;
  }

  const { rows } = parseCsv(csvText, columnMappings);
  if (rows.length === 0) {
    await failJob(jobId, "CSV produced no data rows — check column mappings");
    return;
  }

  const medicineMappings = await prisma.medicineMapping.findMany({ where: { pharmacyId } });
  const mappingLookup    = new Map(medicineMappings.map((m) => [m.csvValue, m]));

  const issues: InventoryImportIssue[] = [];
  let failedRows = 0;

  // Phase 1: validate + resolve each row's medicineId (creating catalog entries
  // for user-confirmed "new" medicines). Persistence happens in phase 2.
  const resolved: ResolvedInventoryRow[] = [];

  for (const row of rows) {
    const { data, issues: rowIssues } = validateInventoryRow(row);
    const rowErrors = rowIssues.filter((i) => i.severity === "error");
    if (!data || rowErrors.length > 0) {
      issues.push(...rowErrors);
      failedRows++;
      continue;
    }
    // Surface non-blocking warnings (near-expiry, pricing anomaly, non-standard GST)
    issues.push(...rowIssues.filter((i) => i.severity === "warning"));

    const csvKey  = data.medicineName.toLowerCase().trim();
    const mapping = mappingLookup.get(csvKey);
    if (!mapping) {
      issues.push({ row: data.rowNumber, field: "medicineName", message: `No medicine mapping confirmed for "${data.medicineName}" — complete the medicine mapping step first`, severity: "error" });
      failedRows++;
      continue;
    }

    let medicineId = mapping.medicineId;
    if (mapping.isNew && !medicineId) {
      try {
        const existingMed = await prisma.medicine.findFirst({ where: { name: { equals: data.medicineName, mode: "insensitive" } } });
        if (existingMed) {
          medicineId = existingMed.id;
        } else {
          const created = await prisma.medicine.create({
            data: { name: data.medicineName, manufacturer: data.manufacturer, hsnCode: data.hsnCode, gstRate: data.gstRate },
          });
          medicineId = created.id;
          await prisma.migrationCreatedRecord.create({ data: { sessionId, entityType: "MEDICINE", entityId: created.id } });
          await prisma.medicineMapping.updateMany({ where: { pharmacyId, csvValue: csvKey }, data: { medicineId: created.id } });
        }
        mappingLookup.set(csvKey, { ...mapping, medicineId });
      } catch (err: any) {
        if (err?.code === "P2002") {
          const race = await prisma.medicine.findFirst({ where: { name: { equals: data.medicineName, mode: "insensitive" } } }).catch(() => null);
          if (race) { medicineId = race.id; mappingLookup.set(csvKey, { ...mapping, medicineId: race.id }); }
        }
        if (!medicineId) {
          issues.push({ row: data.rowNumber, field: "medicineName", message: `Failed to create medicine "${data.medicineName}" — please retry`, severity: "error" });
          failedRows++;
          continue;
        }
      }
    }

    if (!medicineId) {
      issues.push({ row: data.rowNumber, field: "medicineName", message: `Medicine mapping for "${data.medicineName}" has no catalog ID`, severity: "error" });
      failedRows++;
      continue;
    }

    resolved.push({
      rowNumber:    data.rowNumber,
      medicineId,
      medicineName: data.medicineName,
      batchNumber:  data.batchNumber,
      expiryDate:   data.expiryDate,
      quantity:     data.quantity,
      purchaseRate: data.purchaseRate,
      mrp:          data.mrp,
      minimumStock: data.minimumStock,
    });
  }

  // Phase 2: shared bulk insert (skip-existing, dedup, batched, fallback).
  const outcome = await importResolvedInventory(prisma, {
    sessionId, pharmacyId, userId, rows: resolved,
    onCheckpoint: async (processed, success, failed) => {
      await prisma.migrationImportJob.update({
        where: { id: jobId },
        data:  { processedRows: processed, successRows: success, failedRows: failed + failedRows },
      });
    },
  });

  issues.push(...outcome.issues);
  const totalSuccess = outcome.successRows;
  const totalFailed  = failedRows + outcome.failedRows;

  // "Nothing imported and nothing usefully skipped" is a real failure; an
  // all-skipped re-import (success 0, skipped N, failed 0) is not.
  const finalStatus = totalSuccess === 0 && outcome.skippedRows === 0 ? "FAILED" : "COMPLETED";

  await prisma.migrationImportJob.update({
    where: { id: jobId },
    data: {
      status:        finalStatus,
      processedRows: rows.length,
      successRows:   totalSuccess,
      failedRows:    totalFailed,
      errors:        issues as any,
      completedAt:   new Date(),
    },
  });

  if (totalSuccess > 0) {
    const session = await prisma.migrationSession.findUnique({ where: { id: sessionId } });
    if (session) {
      const steps = new Set(session.completedSteps);
      steps.add("inventory");
      await prisma.migrationSession.update({ where: { id: sessionId }, data: { completedSteps: [...steps] } });
    }
  }
}

// ── Suppliers / Customers / Doctors ────────────────────────────────────────────
// Shares validators (@pharmacy/utils) and importers (@pharmacy/database) with
// the synchronous apps/api path.

const ENTITY_STEP: Record<string, string> = { SUPPLIERS: "suppliers", CUSTOMERS: "customers", DOCTORS: "doctors" };

async function processEntityImport(
  entityType:     "SUPPLIERS" | "CUSTOMERS" | "DOCTORS",
  jobId:          string,
  sessionId:      string,
  pharmacyId:     string,
  userId:         string,
  csvText:        string,
  columnMappings: Record<string, string>,
) {
  if (!csvText?.trim()) { await failJob(jobId, "Import job contained no CSV data — please start the migration again"); return; }
  const { rows } = parseCsv(csvText, columnMappings);
  if (rows.length === 0) { await failJob(jobId, "CSV produced no data rows — check column mappings"); return; }

  const issues: EntityImportIssue[] = [];
  let failedRows = 0;

  const checkpoint = async (processed: number) => {
    await prisma.migrationImportJob.update({ where: { id: jobId }, data: { processedRows: processed } }).catch(() => {});
  };

  let outcome;
  if (entityType === "SUPPLIERS") {
    const valid = [];
    for (const row of rows) {
      const { data, issues: ri } = validateSupplierRow(row);
      if (!data) { issues.push(...ri.filter((i) => i.severity === "error")); failedRows++; continue; }
      issues.push(...ri.filter((i) => i.severity === "warning"));
      valid.push(data);
    }
    outcome = await importResolvedSuppliers(prisma, { sessionId, pharmacyId, rows: valid, onCheckpoint: checkpoint });
  } else if (entityType === "CUSTOMERS") {
    const valid = [];
    for (const row of rows) {
      const { data, issues: ri } = validateCustomerRow(row);
      if (!data) { issues.push(...ri.filter((i) => i.severity === "error")); failedRows++; continue; }
      issues.push(...ri.filter((i) => i.severity === "warning"));
      valid.push(data);
    }
    outcome = await importResolvedCustomers(prisma, { sessionId, pharmacyId, userId, rows: valid, onCheckpoint: checkpoint });
  } else {
    const valid = [];
    for (const row of rows) {
      const { data, issues: ri } = validateDoctorRow(row);
      if (!data) { issues.push(...ri.filter((i) => i.severity === "error")); failedRows++; continue; }
      issues.push(...ri.filter((i) => i.severity === "warning"));
      valid.push(data);
    }
    outcome = await importResolvedDoctors(prisma, { sessionId, pharmacyId, rows: valid, onCheckpoint: checkpoint });
  }

  issues.push(...outcome.issues);
  const successRows = outcome.createdRows + outcome.updatedRows;
  const totalFailed = failedRows + outcome.failedRows;
  const finalStatus = successRows === 0 && outcome.skippedRows === 0 ? "FAILED" : "COMPLETED";

  await prisma.migrationImportJob.update({
    where: { id: jobId },
    data: {
      status:        finalStatus,
      processedRows: rows.length,
      successRows,
      failedRows:    totalFailed,
      errors:        issues as any,
      completedAt:   new Date(),
    },
  });

  if (successRows > 0) {
    const session = await prisma.migrationSession.findUnique({ where: { id: sessionId } });
    if (session) {
      const steps = new Set(session.completedSteps);
      steps.add(ENTITY_STEP[entityType]!);
      await prisma.migrationSession.update({ where: { id: sessionId }, data: { completedSteps: [...steps] } });
    }
  }
}
