import type { FastifyInstance } from "fastify";
import { withTenant, type Db } from "@pharmacy/database";
import { AppError } from "../../lib/AppError.js";
import {
  detectColumns,
  parseCsv,
  extractUniqueMedicineNames,
} from "./migration.mapper.js";
import type { ColumnMappings } from "./migration.types.js";
import {
  validateInventoryRow,
  validateSupplierRow,
  validateCustomerRow,
  validateDoctorRow,
} from "./migration.validators.js";
import type {
  CommitResult,
  MedicineSuggestion,
  CatalogMatch,
  RowIssue,
} from "./migration.types.js";
import type {
  CreateSessionInput,
  ConfirmMedicineMappingsInput,
} from "./migration.schemas.js";

const ASYNC_THRESHOLD = 500; // rows above this go to pg-boss

export class MigrationService {
  private db:    Db;
  private meili: FastifyInstance["meilisearch"];
  private app:   FastifyInstance;

  constructor(app: FastifyInstance) {
    this.app   = app;
    this.db    = app.prisma;
    this.meili = app.meilisearch;
  }

  // ── Session management ────────────────────────────────────────────────────

  async createSession(pharmacyId: string, userId: string, input: CreateSessionInput) {
    return this.db.migrationSession.create({
      data: {
        pharmacyId,
        createdBy:      userId,
        sourceSoftware: input.sourceSoftware,
        notes:          input.notes,
        completedSteps: [],
      },
    });
  }

  async listSessions(pharmacyId: string) {
    return this.db.migrationSession.findMany({
      where:   { pharmacyId },
      include: { importJobs: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async getSession(sessionId: string, pharmacyId: string) {
    const session = await this.db.migrationSession.findFirst({
      where:   { id: sessionId, pharmacyId },
      include: {
        importJobs: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!session) throw AppError.notFound("Migration session not found");
    return session;
  }

  async saveColumnMappings(sessionId: string, pharmacyId: string, mappings: ColumnMappings) {
    await this.getSession(sessionId, pharmacyId);
    return this.db.migrationSession.update({
      where: { id: sessionId },
      data:  { columnMappings: mappings as any, currentStep: "column-mapping" },
    });
  }

  // ── Column detection ──────────────────────────────────────────────────────

  detectColumns(headers: string[]) {
    return detectColumns(headers);
  }

  // ── Medicine mapping ──────────────────────────────────────────────────────

  async suggestMedicineMappings(
    pharmacyId: string,
    csvText:    string,
    columnMappings: ColumnMappings,
  ): Promise<MedicineSuggestion[]> {
    const { rows } = parseCsv(csvText, columnMappings);
    const uniqueNames = extractUniqueMedicineNames(rows); // [{ display, key }]

    // Load already-confirmed mappings using lowercase keys (that's how they're stored)
    const existing = await this.db.medicineMapping.findMany({
      where:  { pharmacyId, csvValue: { in: uniqueNames.map((n) => n.key) } },
      select: { csvValue: true, medicineId: true, isNew: true },
    });
    const existingMap = new Map(existing.map((m) => [m.csvValue, m]));

    const suggestions: MedicineSuggestion[] = [];

    for (const { display, key } of uniqueNames) {
      const alreadyMapped = existingMap.get(key);
      if (alreadyMapped) {
        suggestions.push({
          csvValue: display,          // show original case to the pharmacist
          suggestions: [],
          existingMapping: {
            medicineId: alreadyMapped.medicineId,
            isNew:      alreadyMapped.isNew,
          },
        });
        continue;
      }

      // Meilisearch fuzzy search — use original case for better relevance scoring
      const hits = await this.meili
        .index("medicines")
        .search(display, { limit: 3, attributesToRetrieve: ["id", "name", "genericName", "manufacturer", "form", "strength"] })
        .catch(() => ({ hits: [] }));

      const matches: CatalogMatch[] = (hits.hits as any[]).map((h, i) => ({
        medicineId:   h.id,
        name:         h.name,
        genericName:  h.genericName   ?? undefined,
        manufacturer: h.manufacturer  ?? undefined,
        form:         h.form          ?? undefined,
        strength:     h.strength      ?? undefined,
        confidence:   i === 0 ? 0.9 : i === 1 ? 0.7 : 0.5,
      }));

      suggestions.push({ csvValue: display, suggestions: matches });
    }

    return suggestions;
  }

  async confirmMedicineMappings(
    pharmacyId: string,
    sessionId:  string,
    userId:     string,
    input:      ConfirmMedicineMappingsInput,
  ) {
    await this.getSession(sessionId, pharmacyId);

    const ops = input.mappings.map((m) =>
      this.db.medicineMapping.upsert({
        where:  { pharmacyId_csvValue: { pharmacyId, csvValue: m.csvValue.toLowerCase().trim() } },
        update: {
          medicineId:  m.medicineId ?? null,
          isNew:       m.isNew,
          confirmedAt: new Date(),
          confirmedBy: userId,
        },
        create: {
          pharmacyId,
          csvValue:    m.csvValue.toLowerCase().trim(),
          medicineId:  m.medicineId ?? null,
          isNew:       m.isNew,
          confidence:  null,
          confirmedAt: new Date(),
          confirmedBy: userId,
        },
      }),
    );

    return Promise.all(ops);
  }

  // ── Preview inventory (parse + suggest, no writes) ────────────────────────

  async previewInventory(
    pharmacyId:     string,
    csvText:        string,
    columnMappings: ColumnMappings,
  ) {
    const { rows, headers } = parseCsv(csvText, columnMappings);
    const validRows:   ReturnType<typeof validateInventoryRow>["data"][] = [];
    const allIssues:   RowIssue[] = [];

    for (const row of rows) {
      const { data, issues } = validateInventoryRow(row);
      allIssues.push(...issues);
      if (data) validRows.push(data);
    }

    // Check which medicine names still have no confirmed mapping
    const uniqueNames = extractUniqueMedicineNames(rows);
    const existing    = await this.db.medicineMapping.findMany({
      where:  { pharmacyId, csvValue: { in: uniqueNames.map((n) => n.key) } },
      select: { csvValue: true, medicineId: true, isNew: true },
    });
    const mappedSet = new Set(existing.map((m) => m.csvValue));
    const unmapped  = uniqueNames.filter((n) => !mappedSet.has(n.key)).map((n) => n.display);

    return {
      totalRows:    rows.length,
      validRows:    validRows.length,
      errorRows:    rows.length - validRows.length,
      issues:       allIssues,
      headers,
      unmappedMedicines: unmapped,
      sampleRows:   validRows.slice(0, 5),
    };
  }

  // ── Commit inventory ──────────────────────────────────────────────────────

  async commitInventory(
    sessionId:      string,
    pharmacyId:     string,
    userId:         string,
    csvText:        string,
    columnMappings: ColumnMappings,
  ): Promise<CommitResult> {
    await this.getSession(sessionId, pharmacyId);
    const { rows } = parseCsv(csvText, columnMappings);

    if (rows.length > ASYNC_THRESHOLD) {
      return this.dispatchInventoryJob(sessionId, pharmacyId, userId, csvText, columnMappings, rows.length);
    }

    return this.importInventorySync(sessionId, pharmacyId, userId, rows, columnMappings);
  }

  private async dispatchInventoryJob(
    sessionId:      string,
    pharmacyId:     string,
    userId:         string,
    csvText:        string,
    columnMappings: ColumnMappings,
    totalRows:      number,
  ): Promise<CommitResult> {
    const job = await this.db.migrationImportJob.create({
      data: {
        sessionId,
        pharmacyId,
        entityType: "INVENTORY",
        status:     "PENDING",
        totalRows,
      },
    });

    try {
      const { enqueueMigrationImport } = await import("@pharmacy/jobs");
      const pgBossId = await enqueueMigrationImport({
        jobId:          job.id,
        sessionId,
        pharmacyId,
        userId,
        entityType:     "INVENTORY",
        csvText,
        columnMappings,
      });

      await this.db.migrationImportJob.update({
        where: { id: job.id },
        data:  { pgBossJobId: pgBossId ?? undefined, status: "PROCESSING", startedAt: new Date() },
      });
    } catch (err: any) {
      // Enqueue failed — mark the job FAILED so it doesn't stay PENDING forever
      await this.db.migrationImportJob.update({
        where: { id: job.id },
        data:  { status: "FAILED", completedAt: new Date(), errors: [{ row: 0, message: `Failed to enqueue job: ${err?.message ?? "unknown"}`, severity: "error" }] as any },
      });
      throw AppError.internal(`Background job could not be queued: ${err?.message ?? "unknown error"}`);
    }

    return { entityType: "INVENTORY", totalRows, successRows: 0, failedRows: 0, errors: [], jobId: job.id, async: true };
  }

  async importInventorySync(
    sessionId:      string,
    pharmacyId:     string,
    userId:         string,
    rows:           ReturnType<typeof parseCsv>["rows"],
    columnMappings: ColumnMappings,
  ): Promise<CommitResult> {
    // Load all confirmed medicine mappings for this pharmacy
    const medicineMappings = await this.db.medicineMapping.findMany({
      where: { pharmacyId },
    });
    const mappingLookup = new Map(medicineMappings.map((m) => [m.csvValue, m]));

    const errors:      RowIssue[] = [];
    let   successRows  = 0;
    let   failedRows   = 0;

    // Create job record to track progress
    const importJob = await this.db.migrationImportJob.create({
      data: {
        sessionId,
        pharmacyId,
        entityType: "INVENTORY",
        status:     "PROCESSING",
        totalRows:  rows.length,
        startedAt:  new Date(),
      },
    });

    for (const row of rows) {
      const { data, issues } = validateInventoryRow(row);
      const rowErrors = issues.filter((i) => i.severity === "error");

      if (!data || rowErrors.length > 0) {
        errors.push(...(rowErrors.length ? rowErrors : [{ row: row.rowNumber, message: "Validation failed", severity: "error" as const }]));
        failedRows++;
        continue;
      }

      // Resolve medicine ID via confirmed mappings
      const csvKey  = data.medicineName.toLowerCase().trim();
      const mapping = mappingLookup.get(csvKey);

      if (!mapping) {
        errors.push({ row: data.rowNumber, field: "medicineName", message: `No mapping confirmed for "${data.medicineName}" — complete medicine mapping step first`, severity: "error" });
        failedRows++;
        continue;
      }

      let medicineId = mapping.medicineId;

      // If user confirmed this is a new medicine, create it now
      if (mapping.isNew && !medicineId) {
        try {
          const existing = await this.db.medicine.findFirst({
            where: { name: { equals: data.medicineName, mode: "insensitive" } },
          });
          if (existing) {
            medicineId = existing.id;
          } else {
            const created = await this.db.medicine.create({
              data: {
                name:         data.medicineName,
                manufacturer: data.manufacturer,
                hsnCode:      data.hsnCode,
                gstRate:      data.gstRate,
              },
            });
            medicineId = created.id;
            // Track created medicine for rollback
            await this.db.migrationCreatedRecord.create({
              data: { sessionId, entityType: "MEDICINE", entityId: created.id },
            });
            // Update mapping with the new medicine ID so future rows reuse it
            await this.db.medicineMapping.update({
              where: { pharmacyId_csvValue: { pharmacyId, csvValue: csvKey } },
              data:  { medicineId: created.id },
            });
            mappingLookup.set(csvKey, { ...mapping, medicineId: created.id });
          }
        } catch {
          errors.push({ row: data.rowNumber, field: "medicineName", message: `Failed to create medicine "${data.medicineName}"`, severity: "error" });
          failedRows++;
          continue;
        }
      }

      if (!medicineId) {
        errors.push({ row: data.rowNumber, field: "medicineName", message: `Medicine mapping for "${data.medicineName}" has no catalog ID`, severity: "error" });
        failedRows++;
        continue;
      }

      // Import inventory batch + opening movement + audit record in one transaction.
      // Check existence BEFORE upsert so we know whether this is a new or existing
      // batch — tracking and movement records differ between the two paths.
      try {
        await withTenant(this.db, pharmacyId, async (tx) => {
          const priorBatch = await tx.inventory.findUnique({
            where: {
              pharmacyId_medicineId_batchNumber: {
                pharmacyId, medicineId: medicineId!, batchNumber: data.batchNumber,
              },
            },
            select: { id: true, quantity: true },
          });

          const inv = await tx.inventory.upsert({
            where: {
              pharmacyId_medicineId_batchNumber: {
                pharmacyId, medicineId: medicineId!, batchNumber: data.batchNumber,
              },
            },
            update: {
              quantity:     { increment: data.quantity },
              purchaseRate: data.purchaseRate,
              mrp:          data.mrp,
            },
            create: {
              pharmacyId,
              medicineId:   medicineId!,
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
          await tx.inventoryMovement.create({
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
              notes:          "Imported via migration wizard",
            },
          });

          // Only track NEW batches for rollback — updating a pre-existing batch
          // must NOT be rolled back (we'd delete inventory the pharmacy already had).
          if (!priorBatch) {
            await tx.migrationCreatedRecord.create({
              data: { sessionId, entityType: "INVENTORY", entityId: inv.id },
            });
          }
        });

        successRows++;
      } catch (err: any) {
        const isDuplicate = err?.code === "P2002";
        errors.push({
          row:     data.rowNumber,
          message: isDuplicate
            ? `Batch ${data.batchNumber} for this medicine already exists`
            : `Failed to import row: ${err?.message ?? "unknown error"}`,
          severity: "error",
        });
        failedRows++;
      }
    }

    await this.db.migrationImportJob.update({
      where: { id: importJob.id },
      data: {
        status:       failedRows === rows.length ? "FAILED" : "COMPLETED",
        processedRows: rows.length,
        successRows,
        failedRows,
        errors:       errors as any,
        completedAt:  new Date(),
      },
    });

    // Mark step complete if at least some rows succeeded
    if (successRows > 0) {
      await this.markStepComplete(sessionId, "inventory");
    }

    return { entityType: "INVENTORY", totalRows: rows.length, successRows, failedRows, errors, async: false };
  }

  // ── Commit suppliers ──────────────────────────────────────────────────────

  async commitSuppliers(
    sessionId:      string,
    pharmacyId:     string,
    csvText:        string,
    columnMappings: ColumnMappings,
  ): Promise<CommitResult> {
    await this.getSession(sessionId, pharmacyId);
    const { rows } = parseCsv(csvText, columnMappings);

    const errors:     RowIssue[] = [];
    let   successRows = 0;
    let   failedRows  = 0;

    const importJob = await this.db.migrationImportJob.create({
      data: { sessionId, pharmacyId, entityType: "SUPPLIERS", status: "PROCESSING", totalRows: rows.length, startedAt: new Date() },
    });

    for (const row of rows) {
      const { data, issues } = validateSupplierRow(row);
      if (!data) {
        errors.push(...issues.filter((i) => i.severity === "error"));
        failedRows++;
        continue;
      }

      try {
        // Upsert by name — most reliable key without GSTIN
        const existing = await this.db.supplier.findFirst({
          where: {
            pharmacyId,
            OR: [
              { name: { equals: data.supplierName, mode: "insensitive" } },
              ...(data.gstin ? [{ gstin: data.gstin }] : []),
            ],
          },
        });

        let supplierId: string;

        if (existing) {
          await this.db.supplier.update({
            where: { id: existing.id },
            data: {
              gstin:        data.gstin        ?? existing.gstin,
              dlNumber:     data.dlNumber     ?? existing.dlNumber,
              phone:        data.phone        ?? existing.phone,
              email:        data.email        ?? existing.email,
              address:      data.address      ?? existing.address,
              city:         data.city         ?? existing.city,
              state:        data.state        ?? existing.state,
              creditDays:   data.creditDays   ?? existing.creditDays,
              ledgerBalance: data.openingBalance != null ? data.openingBalance : existing.ledgerBalance,
            },
          });
          supplierId = existing.id;
        } else {
          const created = await this.db.supplier.create({
            data: {
              pharmacyId,
              name:          data.supplierName,
              gstin:         data.gstin,
              dlNumber:      data.dlNumber,
              phone:         data.phone,
              email:         data.email,
              address:       data.address,
              city:          data.city,
              state:         data.state,
              creditDays:    data.creditDays ?? 30,
              ledgerBalance: data.openingBalance ?? 0,
            },
          });
          supplierId = created.id;
          await this.db.migrationCreatedRecord.create({
            data: { sessionId, entityType: "SUPPLIERS", entityId: supplierId },
          });
        }

        successRows++;
      } catch {
        errors.push({ row: data.rowNumber, message: `Failed to upsert supplier "${data.supplierName}"`, severity: "error" });
        failedRows++;
      }
    }

    await this.db.migrationImportJob.update({
      where: { id: importJob.id },
      data: { status: "COMPLETED", processedRows: rows.length, successRows, failedRows, errors: errors as any, completedAt: new Date() },
    });

    if (successRows > 0) await this.markStepComplete(sessionId, "suppliers");

    return { entityType: "SUPPLIERS", totalRows: rows.length, successRows, failedRows, errors, async: false };
  }

  // ── Commit customers ──────────────────────────────────────────────────────

  async commitCustomers(
    sessionId:      string,
    pharmacyId:     string,
    userId:         string,
    csvText:        string,
    columnMappings: ColumnMappings,
  ): Promise<CommitResult> {
    await this.getSession(sessionId, pharmacyId);
    const { rows } = parseCsv(csvText, columnMappings);

    const errors:     RowIssue[] = [];
    let   successRows = 0;
    let   failedRows  = 0;

    const importJob = await this.db.migrationImportJob.create({
      data: { sessionId, pharmacyId, entityType: "CUSTOMERS", status: "PROCESSING", totalRows: rows.length, startedAt: new Date() },
    });

    for (const row of rows) {
      const { data, issues } = validateCustomerRow(row);
      if (!data) {
        errors.push(...issues.filter((i) => i.severity === "error"));
        failedRows++;
        continue;
      }

      try {
        // Upsert by phone (best natural key), fall back to name
        const existing = data.phone
          ? await this.db.customer.findFirst({ where: { pharmacyId, phone: data.phone, deletedAt: null } })
          : await this.db.customer.findFirst({ where: { pharmacyId, name: { equals: data.customerName, mode: "insensitive" }, deletedAt: null } });

        let customerId: string;

        if (existing) {
          await this.db.customer.update({
            where: { id: existing.id },
            data: {
              email:          data.email        ?? existing.email,
              address:        data.address      ?? existing.address,
              dateOfBirth:    data.dateOfBirth  ? new Date(data.dateOfBirth) : existing.dateOfBirth,
              gender:         data.gender       ?? existing.gender,
              creditLimit:    data.creditLimit  ?? existing.creditLimit,
              // Do NOT update creditUsed — that tracks real unpaid invoices.
              // openingDue is only meaningful when creating the customer for the first time.
              abhaNumber:     data.abhaNumber   ?? existing.abhaNumber,
              notes:          data.notes        ?? existing.notes,
            },
          });
          customerId = existing.id;
        } else {
          const created = await this.db.customer.create({
            data: {
              pharmacyId,
              name:           data.customerName,
              phone:          data.phone,
              email:          data.email,
              address:        data.address,
              dateOfBirth:    data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
              gender:         data.gender,
              creditLimit:    data.creditLimit   ?? 0,
              creditUsed:     data.openingDue    ?? 0,
              abhaNumber:     data.abhaNumber,
              cardNumber:     data.cardNumber,
              notes:          data.notes,
              customerType:   data.creditLimit && data.creditLimit > 0 ? "CREDIT" : "WALK_IN",
              createdById:    userId,
            },
          });
          customerId = created.id;
          await this.db.migrationCreatedRecord.create({
            data: { sessionId, entityType: "CUSTOMERS", entityId: customerId },
          });
        }

        successRows++;
      } catch {
        errors.push({ row: data.rowNumber, message: `Failed to upsert customer "${data.customerName}"`, severity: "error" });
        failedRows++;
      }
    }

    await this.db.migrationImportJob.update({
      where: { id: importJob.id },
      data: { status: "COMPLETED", processedRows: rows.length, successRows, failedRows, errors: errors as any, completedAt: new Date() },
    });

    if (successRows > 0) await this.markStepComplete(sessionId, "customers");

    return { entityType: "CUSTOMERS", totalRows: rows.length, successRows, failedRows, errors, async: false };
  }

  // ── Commit doctors ────────────────────────────────────────────────────────

  async commitDoctors(
    sessionId:      string,
    pharmacyId:     string,
    csvText:        string,
    columnMappings: ColumnMappings,
  ): Promise<CommitResult> {
    await this.getSession(sessionId, pharmacyId);
    const { rows } = parseCsv(csvText, columnMappings);

    const errors:     RowIssue[] = [];
    let   successRows = 0;
    let   failedRows  = 0;

    const importJob = await this.db.migrationImportJob.create({
      data: { sessionId, pharmacyId, entityType: "DOCTORS", status: "PROCESSING", totalRows: rows.length, startedAt: new Date() },
    });

    for (const row of rows) {
      const { data, issues } = validateDoctorRow(row);
      if (!data) {
        errors.push(...issues.filter((i) => i.severity === "error"));
        failedRows++;
        continue;
      }

      try {
        const existing = data.registrationNo
          ? await this.db.doctor.findFirst({ where: { pharmacyId, registrationNo: data.registrationNo } })
          : await this.db.doctor.findFirst({ where: { pharmacyId, name: { equals: data.doctorName, mode: "insensitive" } } });

        let doctorId: string;

        if (existing) {
          await this.db.doctor.update({
            where: { id: existing.id },
            data: {
              specialty: data.specialty ?? existing.specialty,
              clinic:    data.clinic    ?? existing.clinic,
              phone:     data.phone     ?? existing.phone,
              email:     data.email     ?? existing.email,
            },
          });
          doctorId = existing.id;
        } else {
          const created = await this.db.doctor.create({
            data: {
              pharmacyId,
              name:           data.doctorName,
              registrationNo: data.registrationNo,
              specialty:      data.specialty,
              clinic:         data.clinic,
              phone:          data.phone,
              email:          data.email,
            },
          });
          doctorId = created.id;
          await this.db.migrationCreatedRecord.create({
            data: { sessionId, entityType: "DOCTORS", entityId: doctorId },
          });
        }

        successRows++;
      } catch {
        errors.push({ row: data.rowNumber, message: `Failed to upsert doctor "${data.doctorName}"`, severity: "error" });
        failedRows++;
      }
    }

    await this.db.migrationImportJob.update({
      where: { id: importJob.id },
      data: { status: "COMPLETED", processedRows: rows.length, successRows, failedRows, errors: errors as any, completedAt: new Date() },
    });

    if (successRows > 0) await this.markStepComplete(sessionId, "doctors");

    return { entityType: "DOCTORS", totalRows: rows.length, successRows, failedRows, errors, async: false };
  }

  // ── Rollback ──────────────────────────────────────────────────────────────

  async rollbackSession(sessionId: string, pharmacyId: string) {
    const session = await this.getSession(sessionId, pharmacyId);
    if (session.status === "ROLLED_BACK") {
      throw AppError.conflict("Session has already been rolled back");
    }

    const records = await this.db.migrationCreatedRecord.findMany({
      where:   { sessionId },
      orderBy: { createdAt: "desc" }, // reverse order
    });

    // Delete in reverse dependency order: movements → inventory → medicine → others
    const order: string[] = ["INVENTORY", "MEDICINE", "SUPPLIERS", "CUSTOMERS", "DOCTORS"];
    const byType = new Map<string, string[]>();
    for (const r of records) {
      const list = byType.get(r.entityType) ?? [];
      list.push(r.entityId);
      byType.set(r.entityType, list);
    }

    for (const type of order) {
      const ids = byType.get(type) ?? [];
      if (!ids.length) continue;

      if (type === "INVENTORY") {
        // Delete movements first, then the inventory batch itself
        await this.db.inventoryMovement.deleteMany({
          where: { referenceType: "OPENING_BALANCE", referenceId: sessionId, inventoryId: { in: ids } },
        });
        await this.db.inventory.deleteMany({ where: { id: { in: ids }, pharmacyId } });
      } else if (type === "MEDICINE") {
        // Deactivate rather than delete — other pharmacies may have referenced it
        await this.db.medicine.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });
      } else if (type === "SUPPLIERS") {
        await this.db.supplier.deleteMany({ where: { id: { in: ids }, pharmacyId } });
      } else if (type === "CUSTOMERS") {
        await this.db.customer.deleteMany({ where: { id: { in: ids }, pharmacyId } });
      } else if (type === "DOCTORS") {
        await this.db.doctor.deleteMany({ where: { id: { in: ids }, pharmacyId } });
      }
    }

    return this.db.migrationSession.update({
      where: { id: sessionId },
      data:  { status: "ROLLED_BACK", completedSteps: [] },
    });
  }

  // ── Complete session ──────────────────────────────────────────────────────

  async completeSession(sessionId: string, pharmacyId: string) {
    await this.getSession(sessionId, pharmacyId);
    return this.db.migrationSession.update({
      where: { id: sessionId },
      data:  { status: "COMPLETED", currentStep: "summary" },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async markStepComplete(sessionId: string, step: string) {
    const session = await this.db.migrationSession.findUnique({ where: { id: sessionId } });
    if (!session) return;
    const steps = new Set(session.completedSteps);
    steps.add(step);
    await this.db.migrationSession.update({
      where: { id: sessionId },
      data:  { completedSteps: [...steps], currentStep: step },
    });
  }

}
