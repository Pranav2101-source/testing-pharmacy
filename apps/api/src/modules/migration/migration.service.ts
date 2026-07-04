import type { FastifyInstance } from "fastify";
import {
  type Db,
  importResolvedInventory, type ResolvedInventoryRow,
  importResolvedSuppliers, importResolvedCustomers, importResolvedDoctors,
  type EntityImportOutcome,
} from "@pharmacy/database";
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

const ASYNC_THRESHOLD = 500;    // rows above this go to pg-boss (off the HTTP request)
const MAX_IMPORT_ROWS  = 50_000; // hard cap per file — beyond this, ask the user to split

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

  // #12 — Prior successful imports for this pharmacy (across all sessions), most
  // recent per entity type. The wizard uses this to warn "you've imported X
  // before" so a pharmacist doesn't unknowingly re-run the wrong file.
  async getImportHistory(pharmacyId: string) {
    const jobs = await this.db.migrationImportJob.findMany({
      // Exclude jobs whose session was rolled back — that data no longer exists,
      // so it must not trigger the "already imported" warning.
      where:   { pharmacyId, status: "COMPLETED", successRows: { gt: 0 }, session: { status: { not: "ROLLED_BACK" } } },
      orderBy: { completedAt: "desc" },
      select:  { entityType: true, successRows: true, completedAt: true },
    });
    const seen = new Set<string>();
    const latestPerEntity: { entityType: string; successRows: number; completedAt: Date | null }[] = [];
    for (const j of jobs) {
      if (seen.has(j.entityType)) continue;
      seen.add(j.entityType);
      latestPerEntity.push(j);
    }
    return latestPerEntity;
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
    this.guardRowCount(rows.length);
    const uniqueNames = extractUniqueMedicineNames(rows); // [{ display, key }]

    // No medicineName column mapped or CSV was empty
    if (uniqueNames.length === 0) return [];

    // Load already-confirmed mappings using lowercase keys (that's how they're stored)
    const existing = await this.db.medicineMapping.findMany({
      where:  { pharmacyId, csvValue: { in: uniqueNames.map((n) => n.key) } },
      select: { csvValue: true, medicineId: true, isNew: true },
    });
    const existingMap = new Map(existing.map((m) => [m.csvValue, m]));

    // Sequentially awaiting one Meilisearch round-trip per unique medicine name
    // would take minutes on a file with thousands of distinct names (a large
    // migration file easily has 1000s of unique medicines even after row-count
    // capping). Bounded-concurrency fan-out keeps this fast without hammering
    // Meilisearch with thousands of simultaneous requests.
    const SEARCH_CONCURRENCY = 10;
    const suggestions: MedicineSuggestion[] = new Array(uniqueNames.length);

    let cursor = 0;
    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= uniqueNames.length) return;
        const { display, key } = uniqueNames[i]!;

        const alreadyMapped = existingMap.get(key);
        if (alreadyMapped) {
          suggestions[i] = {
            csvValue: display,          // show original case to the pharmacist
            suggestions: [],
            existingMapping: {
              medicineId: alreadyMapped.medicineId,
              isNew:      alreadyMapped.isNew,
            },
          };
          continue;
        }

        // Meilisearch fuzzy search — use original case for better relevance scoring
        const hits = await this.meili
          .index("medicines")
          .search(display, { limit: 3, attributesToRetrieve: ["id", "name", "genericName", "manufacturer", "form", "strength"] })
          .catch((err) => {
            this.app.log.warn({ err, medicineName: display }, "[migration] Meilisearch search failed — returning no suggestions");
            return { hits: [] };
          });

        const matches: CatalogMatch[] = (hits.hits as any[]).map((h, i2) => ({
          medicineId:   h.id,
          name:         h.name,
          genericName:  h.genericName   ?? undefined,
          manufacturer: h.manufacturer  ?? undefined,
          form:         h.form          ?? undefined,
          strength:     h.strength      ?? undefined,
          confidence:   i2 === 0 ? 0.9 : i2 === 1 ? 0.7 : 0.5,
        }));

        suggestions[i] = { csvValue: display, suggestions: matches };
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(SEARCH_CONCURRENCY, uniqueNames.length) }, worker),
    );

    return suggestions;
  }

  async confirmMedicineMappings(
    pharmacyId: string,
    sessionId:  string,
    userId:     string,
    input:      ConfirmMedicineMappingsInput,
  ) {
    await this.getSession(sessionId, pharmacyId);

    // Sequential upserts so a failure on one mapping gives a clear error
    // (Promise.all would give an ambiguous partial-save state)
    const results: any[] = [];
    for (const m of input.mappings) {
      try {
        results.push(
          await this.db.medicineMapping.upsert({
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
      } catch (err: any) {
        this.app.log.error({ err, csvValue: m.csvValue }, "[migration] medicine mapping upsert failed");
        const isFk = err?.code === "P2003";
        throw new Error(
          isFk
            ? `Medicine "${m.csvValue}" references a catalog entry that no longer exists — please re-select`
            : `Could not save mapping for "${m.csvValue}" — please retry`,
          { cause: err },
        );
      }
    }
    return results;
  }

  // ── Preview inventory (parse + suggest, no writes) ────────────────────────

  async previewInventory(
    pharmacyId:     string,
    csvText:        string,
    columnMappings: ColumnMappings,
  ) {
    const { rows, headers } = parseCsv(csvText, columnMappings);
    this.guardRowCount(rows.length);
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

    this.guardEmptyAndRowCount(rows.length);

    if (rows.length > ASYNC_THRESHOLD) {
      return this.dispatchJob("INVENTORY", sessionId, pharmacyId, userId, csvText, columnMappings, rows.length);
    }

    return this.importInventorySync(sessionId, pharmacyId, userId, rows, columnMappings);
  }

  // #7 — Reject empty files and files beyond the hard cap with a clear,
  // actionable error, rather than letting an enormous payload time out silently
  // or an empty one produce a confusing "FAILED, 0 rows, no reason given" job.
  private guardEmptyAndRowCount(count: number) {
    if (count === 0) {
      throw AppError.badRequest("The CSV produced no data rows — check your column mappings and file content");
    }
    this.guardRowCount(count);
  }

  private guardRowCount(count: number) {
    if (count > MAX_IMPORT_ROWS) {
      throw AppError.badRequest(
        `This file has ${count.toLocaleString("en-IN")} rows, which exceeds the ${MAX_IMPORT_ROWS.toLocaleString("en-IN")}-row limit per import. Please split it into smaller files and import them one at a time.`,
      );
    }
  }

  // Generic pg-boss dispatch for any entity type (keeps a large import off the
  // HTTP request). Returns an async CommitResult carrying the job id to poll.
  private async dispatchJob(
    entityType:     "INVENTORY" | "SUPPLIERS" | "CUSTOMERS" | "DOCTORS",
    sessionId:      string,
    pharmacyId:     string,
    userId:         string,
    csvText:        string,
    columnMappings: ColumnMappings,
    totalRows:      number,
  ): Promise<CommitResult> {
    const job = await this.db.migrationImportJob.create({
      data: { sessionId, pharmacyId, entityType, status: "PENDING", totalRows },
    });

    try {
      const { enqueueMigrationImport } = await import("@pharmacy/jobs");
      const pgBossId = await enqueueMigrationImport({ jobId: job.id, sessionId, pharmacyId, userId, entityType, csvText, columnMappings });

      // boss.send() returns null when the queue rejects the job (full / duplicate key)
      if (pgBossId === null) {
        throw new Error("Import queue rejected the job — it may be at capacity. Please retry in a moment.");
      }

      await this.db.migrationImportJob.update({
        where: { id: job.id },
        data:  { pgBossJobId: pgBossId, status: "PROCESSING", startedAt: new Date() },
      });
    } catch (err: any) {
      // Enqueue failed — mark the job FAILED so it doesn't stay PENDING forever
      await this.db.migrationImportJob.update({
        where: { id: job.id },
        data:  { status: "FAILED", completedAt: new Date(), errors: [{ row: 0, message: `Failed to enqueue job: ${err?.message ?? "unknown"}`, severity: "error" }] as any },
      });
      throw AppError.internal(`Background job could not be queued: ${err?.message ?? "unknown error"}`);
    }

    return { entityType, totalRows, successRows: 0, failedRows: 0, errors: [], jobId: job.id, async: true };
  }

  async importInventorySync(
    sessionId:      string,
    pharmacyId:     string,
    userId:         string,
    rows:           ReturnType<typeof parseCsv>["rows"],
    _columnMappings: ColumnMappings,
  ): Promise<CommitResult> {
    // Load all confirmed medicine mappings for this pharmacy
    const medicineMappings = await this.db.medicineMapping.findMany({ where: { pharmacyId } });
    const mappingLookup = new Map(medicineMappings.map((m) => [m.csvValue, m]));

    const errors:     RowIssue[] = [];
    let   failedRows  = 0;

    // Create job record to track progress (wrap in try/catch — import data
    // integrity must not depend on the tracking row succeeding).
    let importJob: { id: string };
    try {
      importJob = await this.db.migrationImportJob.create({
        data: { sessionId, pharmacyId, entityType: "INVENTORY", status: "PROCESSING", totalRows: rows.length, startedAt: new Date() },
      });
    } catch (err: any) {
      this.app.log.error({ err }, "[migration] Failed to create import job record");
      throw AppError.internal("Could not initialise the import — please retry");
    }

    // Phase 1: validate + resolve each row's medicineId (creating catalog
    // entries for user-confirmed "new" medicines). Persistence is phase 2.
    const resolved: ResolvedInventoryRow[] = [];

    for (const row of rows) {
      const { data, issues } = validateInventoryRow(row);
      const rowErrors = issues.filter((i) => i.severity === "error");

      if (!data || rowErrors.length > 0) {
        errors.push(...(rowErrors.length ? rowErrors : [{ row: row.rowNumber, message: "Validation failed", severity: "error" as const }]));
        failedRows++;
        continue;
      }
      // Surface non-blocking warnings (near-expiry, pricing anomaly, non-standard GST)
      errors.push(...issues.filter((i) => i.severity === "warning"));

      const csvKey  = data.medicineName.toLowerCase().trim();
      const mapping = mappingLookup.get(csvKey);
      if (!mapping) {
        errors.push({ row: data.rowNumber, field: "medicineName", message: `No mapping confirmed for "${data.medicineName}" — complete medicine mapping step first`, severity: "error" });
        failedRows++;
        continue;
      }

      let medicineId = mapping.medicineId;
      if (mapping.isNew && !medicineId) {
        try {
          const existing = await this.db.medicine.findFirst({ where: { name: { equals: data.medicineName, mode: "insensitive" } } });
          if (existing) {
            medicineId = existing.id;
          } else {
            const created = await this.db.medicine.create({
              data: { name: data.medicineName, manufacturer: data.manufacturer, hsnCode: data.hsnCode, gstRate: data.gstRate },
            });
            medicineId = created.id;
            await this.db.migrationCreatedRecord.create({ data: { sessionId, entityType: "MEDICINE", entityId: created.id } });
            await this.db.medicineMapping.update({ where: { pharmacyId_csvValue: { pharmacyId, csvValue: csvKey } }, data: { medicineId: created.id } });
          }
          mappingLookup.set(csvKey, { ...mapping, medicineId });
        } catch (err: any) {
          this.app.log.warn({ err, medicineName: data.medicineName }, "[migration] medicine creation failed");
          if (err?.code === "P2002") {
            const race = await this.db.medicine.findFirst({ where: { name: { equals: data.medicineName, mode: "insensitive" } } }).catch(() => null);
            if (race) { medicineId = race.id; mappingLookup.set(csvKey, { ...mapping, medicineId: race.id }); }
          }
          if (!medicineId) {
            errors.push({ row: data.rowNumber, field: "medicineName", message: `Failed to create medicine "${data.medicineName}" — please retry`, severity: "error" });
            failedRows++;
            continue;
          }
        }
      }

      if (!medicineId) {
        errors.push({ row: data.rowNumber, field: "medicineName", message: `Medicine mapping for "${data.medicineName}" has no catalog ID`, severity: "error" });
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

    // Phase 2: shared bulk insert (skip-existing, dedup, batched, per-row fallback).
    // Wrapped so an unexpected crash here (e.g. a DB connection blip on the
    // initial preload query) still finalizes the job as FAILED instead of
    // leaving it stuck in PROCESSING forever — which would otherwise permanently
    // block this session's rollback and "Complete Migration" guards.
    let outcome: Awaited<ReturnType<typeof importResolvedInventory>>;
    try {
      outcome = await importResolvedInventory(this.db, { sessionId, pharmacyId, userId, rows: resolved });
    } catch (err: any) {
      this.app.log.error({ err, importJobId: importJob.id }, "[migration] Inventory bulk import crashed");
      await this.db.migrationImportJob.update({
        where: { id: importJob.id },
        data: {
          status: "FAILED", processedRows: rows.length, successRows: 0, failedRows: rows.length,
          errors: [...errors, { row: 0, message: `Import failed unexpectedly: ${err?.message ?? "unknown error"} — no rows were saved, please retry`, severity: "error" }] as any,
          completedAt: new Date(),
        },
      }).catch((e) => this.app.log.error({ e, importJobId: importJob.id }, "[migration] Failed to mark crashed job as FAILED"));
      throw AppError.internal("The import failed unexpectedly and no rows were saved. Please retry.");
    }
    errors.push(...outcome.issues);

    const successRows = outcome.successRows;
    const totalFailed = failedRows + outcome.failedRows;

    // Wrap final status update — import data is committed, only tracking is at risk.
    try {
      await this.db.migrationImportJob.update({
        where: { id: importJob.id },
        data: {
          status:        successRows === 0 && outcome.skippedRows === 0 ? "FAILED" : "COMPLETED",
          processedRows: rows.length,
          successRows,
          failedRows:    totalFailed,
          errors:        errors as any,
          completedAt:   new Date(),
        },
      });
    } catch (err: any) {
      this.app.log.error({ err, importJobId: importJob.id }, "[migration] Failed to finalize import job status — inventory data was committed");
    }

    if (successRows > 0) {
      await this.markStepComplete(sessionId, "inventory");
    }

    return { entityType: "INVENTORY", totalRows: rows.length, successRows, failedRows: totalFailed, skippedRows: outcome.skippedRows, errors, async: false };
  }

  // ── Commit suppliers ──────────────────────────────────────────────────────

  async commitSuppliers(
    sessionId:      string,
    pharmacyId:     string,
    userId:         string,
    csvText:        string,
    columnMappings: ColumnMappings,
  ): Promise<CommitResult> {
    return this.commitEntity(
      "SUPPLIERS", "suppliers", sessionId, pharmacyId, userId, csvText, columnMappings,
      (rows) => this.collectValid(rows, validateSupplierRow),
      (valid, onCheckpoint) => importResolvedSuppliers(this.db, { sessionId, pharmacyId, rows: valid, onCheckpoint }),
    );
  }

  // Generic sync-commit for suppliers/customers/doctors: guard size, dispatch
  // large files to pg-boss, otherwise validate + run the shared importer +
  // finalize the job. Keeps the three entity paths identical.
  private async commitEntity(
    entityType:     "SUPPLIERS" | "CUSTOMERS" | "DOCTORS",
    step:           string,
    sessionId:      string,
    pharmacyId:     string,
    userId:         string,
    csvText:        string,
    columnMappings: ColumnMappings,
    collect:        (rows: ReturnType<typeof parseCsv>["rows"]) => { valid: any[]; errors: RowIssue[]; failedRows: number },
    runImport:      (valid: any[], onCheckpoint?: (processed: number) => Promise<void>) => Promise<EntityImportOutcome>,
  ): Promise<CommitResult> {
    await this.getSession(sessionId, pharmacyId);
    const { rows } = parseCsv(csvText, columnMappings);
    this.guardEmptyAndRowCount(rows.length);

    if (rows.length > ASYNC_THRESHOLD) {
      return this.dispatchJob(entityType, sessionId, pharmacyId, userId, csvText, columnMappings, rows.length);
    }

    const importJob = await this.db.migrationImportJob.create({
      data: { sessionId, pharmacyId, entityType, status: "PROCESSING", totalRows: rows.length, startedAt: new Date() },
    });

    const { valid, errors, failedRows } = collect(rows);

    // Wrapped for the same reason as the inventory path: a crash here must
    // still finalize the job as FAILED, or it stays PROCESSING forever and
    // permanently blocks this session's rollback/complete guards.
    let outcome: EntityImportOutcome;
    try {
      outcome = await runImport(valid);
    } catch (err: any) {
      this.app.log.error({ err, entityType, importJobId: importJob.id }, "[migration] Entity import crashed");
      await this.db.migrationImportJob.update({
        where: { id: importJob.id },
        data: {
          status: "FAILED", processedRows: rows.length, successRows: 0, failedRows: rows.length,
          errors: [...errors, { row: 0, message: `Import failed unexpectedly: ${err?.message ?? "unknown error"} — no rows were saved, please retry`, severity: "error" }] as any,
          completedAt: new Date(),
        },
      }).catch((e) => this.app.log.error({ e, importJobId: importJob.id }, "[migration] Failed to mark crashed job as FAILED"));
      throw AppError.internal("The import failed unexpectedly and no rows were saved. Please retry.");
    }
    errors.push(...outcome.issues);

    const successRows = outcome.createdRows + outcome.updatedRows;
    const totalFailed = failedRows + outcome.failedRows;

    try {
      await this.db.migrationImportJob.update({
        where: { id: importJob.id },
        data: {
          status:        successRows === 0 && outcome.skippedRows === 0 ? "FAILED" : "COMPLETED",
          processedRows: rows.length,
          successRows,
          failedRows:    totalFailed,
          errors:        errors as any,
          completedAt:   new Date(),
        },
      });
    } catch (err: unknown) {
      this.app.log.error({ err, entityType }, "[migration] Failed to finalize import job status");
    }

    if (successRows > 0) await this.markStepComplete(sessionId, step);

    return { entityType, totalRows: rows.length, successRows, failedRows: totalFailed, skippedRows: outcome.skippedRows, errors, async: false };
  }

  // Validate every row, splitting into importable rows + collected issues.
  private collectValid<T extends { rowNumber: number }>(
    rows:     ReturnType<typeof parseCsv>["rows"],
    validate: (row: ReturnType<typeof parseCsv>["rows"][number]) => { data: T | null; issues: RowIssue[] },
  ): { valid: T[]; errors: RowIssue[]; failedRows: number } {
    const valid: T[] = [];
    const errors: RowIssue[] = [];
    let failedRows = 0;
    for (const row of rows) {
      const { data, issues } = validate(row);
      if (!data) {
        errors.push(...issues.filter((i) => i.severity === "error"));
        failedRows++;
        continue;
      }
      // Surface non-blocking warnings (malformed GSTIN/phone, unparseable/future DOB, etc.)
      errors.push(...issues.filter((i) => i.severity === "warning"));
      valid.push(data);
    }
    return { valid, errors, failedRows };
  }

  // ── Commit customers ──────────────────────────────────────────────────────

  async commitCustomers(
    sessionId:      string,
    pharmacyId:     string,
    userId:         string,
    csvText:        string,
    columnMappings: ColumnMappings,
  ): Promise<CommitResult> {
    return this.commitEntity(
      "CUSTOMERS", "customers", sessionId, pharmacyId, userId, csvText, columnMappings,
      (rows) => this.collectValid(rows, validateCustomerRow),
      (valid, onCheckpoint) => importResolvedCustomers(this.db, { sessionId, pharmacyId, userId, rows: valid, onCheckpoint }),
    );
  }

  // ── Commit doctors ────────────────────────────────────────────────────────

  async commitDoctors(
    sessionId:      string,
    pharmacyId:     string,
    userId:         string,
    csvText:        string,
    columnMappings: ColumnMappings,
  ): Promise<CommitResult> {
    return this.commitEntity(
      "DOCTORS", "doctors", sessionId, pharmacyId, userId, csvText, columnMappings,
      (rows) => this.collectValid(rows, validateDoctorRow),
      (valid, onCheckpoint) => importResolvedDoctors(this.db, { sessionId, pharmacyId, rows: valid, onCheckpoint }),
    );
  }

  // ── Rollback ──────────────────────────────────────────────────────────────

  async rollbackSession(sessionId: string, pharmacyId: string) {
    const session = await this.getSession(sessionId, pharmacyId);
    if (session.status === "ROLLED_BACK") {
      throw AppError.conflict("Session has already been rolled back");
    }
    // A background job may still be inserting inventory/records for this
    // session right now. Rolling back mid-flight would delete the snapshot
    // taken here while the worker keeps writing — leaving orphaned rows the
    // session (now ROLLED_BACK) no longer accounts for. The frontend already
    // hides the rollback button while a job is PROCESSING; this is the
    // server-side backstop for a stale tab / direct API call / race.
    if (session.importJobs.some((j) => j.status === "PROCESSING" || j.status === "PENDING")) {
      throw AppError.conflict("An import for this session is still running in the background — wait for it to finish before rolling back.");
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

    // Wrap all deletes + the session status update in one transaction so a
    // mid-rollback failure leaves nothing in a half-deleted state.
    await this.db.$transaction(async (tx) => {
      for (const type of order) {
        const ids = byType.get(type) ?? [];
        if (!ids.length) continue;

        if (type === "INVENTORY") {
          // Delete movements first (FK dependency), then the inventory batch itself
          await tx.inventoryMovement.deleteMany({
            where: { referenceType: "OPENING_BALANCE", referenceId: sessionId, inventoryId: { in: ids } },
          });
          await tx.inventory.deleteMany({ where: { id: { in: ids }, pharmacyId } });
        } else if (type === "MEDICINE") {
          // Deactivate rather than delete — other pharmacies may have referenced it
          await tx.medicine.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });
        } else if (type === "SUPPLIERS") {
          await tx.supplier.deleteMany({ where: { id: { in: ids }, pharmacyId } });
        } else if (type === "CUSTOMERS") {
          await tx.customer.deleteMany({ where: { id: { in: ids }, pharmacyId } });
        } else if (type === "DOCTORS") {
          await tx.doctor.deleteMany({ where: { id: { in: ids }, pharmacyId } });
        }
      }

      await tx.migrationSession.update({
        where: { id: sessionId },
        data:  { status: "ROLLED_BACK", completedSteps: [] },
      });
    }, { timeout: 30_000 });

    return this.db.migrationSession.findUniqueOrThrow({ where: { id: sessionId } });
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
    try {
      const session = await this.db.migrationSession.findUnique({ where: { id: sessionId } });
      if (!session) return;
      const steps = new Set(session.completedSteps);
      steps.add(step);
      await this.db.migrationSession.update({
        where: { id: sessionId },
        data:  { completedSteps: [...steps], currentStep: step },
      });
    } catch (err) {
      // Non-fatal — import data was already committed; only the step tracking record failed
      this.app.log.warn({ err, sessionId, step }, "[migration] markStepComplete failed");
    }
  }

}
