import type { FastifyInstance } from "fastify";
import { MedicinesRepo } from "./medicines.repo.js";
import type { CreateMedicineInput, UpdateMedicineInput, ListMedicinesQuery } from "./medicines.schema.js";

const INDEX = "medicines";
const SEARCH_ATTRS = [
  "id", "name", "genericName", "manufacturer", "composition",
  "category", "schedule", "gstRate", "form", "strength",
  "unit", "packSize", "isActive",
];

export class MedicinesService {
  private repo:  MedicinesRepo;
  private meili: FastifyInstance["meilisearch"];

  constructor(app: FastifyInstance) {
    this.repo  = new MedicinesRepo(app.prisma);
    this.meili = app.meilisearch;
  }

  private async syncOne(medicine: Record<string, unknown>) {
    await this.meili.index(INDEX).addDocuments([medicine]);
  }

  async create(input: CreateMedicineInput) {
    const dup = await this.repo.checkDuplicate(input.name);
    if (dup) {
      throw Object.assign(
        new Error(`Medicine "${input.name}" already exists`),
        { statusCode: 409 },
      );
    }
    const medicine = await this.repo.create(input);
    await this.syncOne(medicine as Record<string, unknown>);
    return medicine;
  }

  async update(id: string, input: UpdateMedicineInput) {
    const existing = await this.repo.getById(id);
    if (!existing) {
      throw Object.assign(new Error("Medicine not found"), { statusCode: 404 });
    }
    if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      const dup = await this.repo.checkDuplicate(input.name, id);
      if (dup) {
        throw Object.assign(
          new Error(`Medicine "${input.name}" already exists`),
          { statusCode: 409 },
        );
      }
    }
    const medicine = await this.repo.update(id, input);
    await this.syncOne(medicine as Record<string, unknown>);
    return medicine;
  }

  async getById(id: string) {
    const medicine = await this.repo.getById(id);
    if (!medicine) {
      throw Object.assign(new Error("Medicine not found"), { statusCode: 404 });
    }
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
    if (!existing) {
      throw Object.assign(new Error("Medicine not found"), { statusCode: 404 });
    }
    const medicine = await this.repo.update(id, { isActive: false });
    await this.syncOne(medicine as Record<string, unknown>);
    return medicine;
  }

  async reactivate(id: string) {
    const existing = await this.repo.getById(id);
    if (!existing) {
      throw Object.assign(new Error("Medicine not found"), { statusCode: 404 });
    }
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
    } catch { /* fall through to Postgres */ }

    // Postgres fallback — runs if Meilisearch is empty or unreachable
    const pg = await this.repo.list({
      page:   1,
      limit,
      search: q,
      isActive: true,
    });
    return pg.items;
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

    for (const row of rows) {
      try {
        const dup = await this.repo.checkDuplicate(row.name);
        if (dup) { results.skipped++; continue; }
        const medicine = await this.repo.create(row);
        toIndex.push(medicine as Record<string, unknown>);
        results.added++;
      } catch (err: any) {
        results.failed++;
        results.errors.push(`${row.name}: ${err.message}`);
      }
    }

    if (toIndex.length > 0) {
      await this.meili.index(INDEX).addDocuments(toIndex);
    }

    return results;
  }
}
