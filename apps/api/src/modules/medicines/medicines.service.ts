import type { FastifyInstance } from "fastify";
import { MedicinesRepo } from "./medicines.repo.js";
import type { CreateMedicineInput, UpdateMedicineInput, ListMedicinesQuery } from "./medicines.schema.js";
import { AppError } from "../../lib/AppError.js";

const INDEX       = "medicines";
const BULK_CHUNK  = 50; // rows per Prisma transaction in bulkCreate
const SEARCH_ATTRS = [
  "id", "name", "genericName", "manufacturer", "composition",
  "category", "schedule", "gstRate", "form", "strength",
  "unit", "packSize", "isActive",
];

export class MedicinesService {
  private repo:  MedicinesRepo;
  private meili: FastifyInstance["meilisearch"];
  private log:   FastifyInstance["log"];

  constructor(app: FastifyInstance) {
    this.repo  = new MedicinesRepo(app.prisma);
    this.meili = app.meilisearch;
    this.log   = app.log;
  }

  private async syncOne(medicine: Record<string, unknown>) {
    try {
      await this.meili.index(INDEX).addDocuments([medicine]);
    } catch (err) {
      // Non-fatal: log and continue — the DB record is already saved.
      // The next scheduled reindex (or manual /reindex call) will fix the gap.
      this.log.warn({ err, medicineId: medicine["id"] }, "Meilisearch sync failed — index may be stale");
    }
  }

  async create(input: CreateMedicineInput) {
    const dup = await this.repo.checkDuplicate(input.name);
    if (dup) {
      throw AppError.conflict(`Medicine "${input.name}" already exists`);
    }
    const medicine = await this.repo.create(input);
    await this.syncOne(medicine as Record<string, unknown>);
    return medicine;
  }

  async update(id: string, input: UpdateMedicineInput) {
    const existing = await this.repo.getById(id);
    if (!existing) throw AppError.notFound("Medicine not found");

    if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      const dup = await this.repo.checkDuplicate(input.name, id);
      if (dup) throw AppError.conflict(`Medicine "${input.name}" already exists`);
    }

    const medicine = await this.repo.update(id, input);
    await this.syncOne(medicine as Record<string, unknown>);
    return medicine;
  }

  async getById(id: string) {
    const medicine = await this.repo.getById(id);
    if (!medicine) throw AppError.notFound("Medicine not found");
    return medicine;
  }

  async list(query: ListMedicinesQuery) {
    return this.repo.list({
      page:     Math.max(1, query.page),
      limit:    Math.min(100, Math.max(1, query.limit)),
      search:   query.search?.trim() || undefined,
      category: query.category,
      schedule: query.schedule,
      form:     query.form,
      isActive: query.isActive,
    });
  }

  async deactivate(id: string) {
    const existing = await this.repo.getById(id);
    if (!existing) throw AppError.notFound("Medicine not found");
    const medicine = await this.repo.update(id, { isActive: false });
    await this.syncOne(medicine as Record<string, unknown>);
    return medicine;
  }

  async reactivate(id: string) {
    const existing = await this.repo.getById(id);
    if (!existing) throw AppError.notFound("Medicine not found");
    const medicine = await this.repo.update(id, { isActive: true });
    await this.syncOne(medicine as Record<string, unknown>);
    return medicine;
  }

  async search(q: string, limit = 10) {
    try {
      const results = await this.meili.index(INDEX).search(q, {
        limit,
        attributesToRetrieve: SEARCH_ATTRS,
      });
      if (results.hits.length > 0) return results.hits;
      // Meilisearch returned zero hits — may be empty index, fall through to Postgres
      this.log.debug({ q }, "Meilisearch returned 0 hits — falling back to Postgres");
    } catch (err) {
      // Meilisearch is unreachable — log and fall through so billing POS keeps working
      this.log.warn({ err, q }, "Meilisearch search failed — falling back to Postgres full-text scan");
    }

    const pg = await this.repo.list({ page: 1, limit, search: q, isActive: true });
    return pg.items;
  }

  async findByBarcode(barcode: string) {
    return this.repo.findByBarcode(barcode.trim());
  }

  async reindex() {
    const all = await this.repo.listAll();
    if (all.length === 0) return { indexed: 0 };
    await this.meili.index(INDEX).addDocuments(all as Record<string, unknown>[]);
    return { indexed: all.length };
  }

  async bulkCreate(rows: CreateMedicineInput[]) {
    const results = { added: 0, skipped: 0, failed: 0, errors: [] as string[] };
    const toIndex: Record<string, unknown>[] = [];

    // Process rows in chunks — each chunk runs in a single Prisma transaction
    // so a failure in one chunk does not silently leave a partial import for
    // rows in the same chunk; it rolls back that chunk cleanly.
    for (let i = 0; i < rows.length; i += BULK_CHUNK) {
      const chunk = rows.slice(i, i + BULK_CHUNK);

      try {
        const chunkResults = await this.repo.createManyInTransaction(chunk);
        results.added   += chunkResults.created.length;
        results.skipped += chunkResults.skipped.length;
        toIndex.push(...chunkResults.created as Record<string, unknown>[]);

        for (const name of chunkResults.skipped) {
          results.errors.push(`${name}: already exists — skipped`);
        }
      } catch (err: any) {
        results.failed += chunk.length;
        results.errors.push(`Chunk ${Math.floor(i / BULK_CHUNK) + 1}: ${err.message}`);
      }
    }

    if (toIndex.length > 0) {
      await this.meili.index(INDEX).addDocuments(toIndex);
    }

    return results;
  }

  async getAlternatives(id: string) {
    const source = await this.repo.getById(id);
    if (!source) throw AppError.notFound("Medicine not found");

    // No genericName means no meaningful substitution can be suggested
    if (!source.genericName) return [];

    return this.repo.findAlternatives(id, source.genericName);
  }
}
