import type { FastifyInstance } from "fastify";
import { InventoryRepo } from "./inventory.repo.js";
import type {
  AddStockInput, AdjustStockInput, ReserveStockInput,
  UpdateBatchStatusInput, ListInventoryQuery, ListLedgerQuery,
  BatchRecallInput, ListBatchRecallQuery,
} from "./inventory.schema.js";

import { AppError } from "../../lib/AppError.js";
import { notifyOwners } from "../../lib/notifications.js";
import { TtlCache } from "../../lib/ttl-cache.js";

// 30-second TTL keeps results practically current while absorbing rapid refreshes.
const INVENTORY_CACHE_TTL_S = 30;

// Compound string key: pharmacyId + serialized query params.
const inventoryCache = new TtlCache<string, unknown>();
const inventoryListKey = (pharmacyId: string, params: object) =>
  `${pharmacyId}:${JSON.stringify(params)}`;

export class InventoryService {
  private repo: InventoryRepo;
  private app:  FastifyInstance;

  constructor(app: FastifyInstance) {
    this.app  = app;
    this.repo = new InventoryRepo(app.prisma);
  }

  async addStock(pharmacyId: string, input: AddStockInput) {
    return this.repo.upsertBatch(pharmacyId, { ...input, expiryDate: new Date(input.expiryDate) });
  }

  // ── Per-pharmacy override overlay ─────────────────────────────────────────
  // Billing checkout applies pharmacy GST overrides authoritatively; this
  // overlay makes pharmacy-scoped inventory reads carry the same effective
  // gstRate so the POS cart preview matches the final invoice. Overridden
  // items are flagged (gstRateOverridden) and carry the standing discount.

  private async applyMedicineOverrides(
    pharmacyId: string,
    items: Array<{ medicineId: string; medicine?: Record<string, unknown> | null }>,
  ): Promise<void> {
    if (items.length === 0) return;
    const overrides = await this.repo.getMedicineOverrides(
      pharmacyId,
      [...new Set(items.map((i) => i.medicineId))],
    );
    if (overrides.length === 0) return;

    const byMedicine = new Map(overrides.map((o) => [o.medicineId, o]));
    for (const item of items) {
      const o = byMedicine.get(item.medicineId);
      if (!o || !item.medicine) continue;
      if (o.gstRate !== null) {
        item.medicine["gstRate"]           = o.gstRate;
        item.medicine["gstRateOverridden"] = true;
      }
      if (o.defaultDiscountPct !== null) {
        item.medicine["defaultDiscountPct"] = o.defaultDiscountPct;
      }
    }
  }

  async list(pharmacyId: string, query: ListInventoryQuery) {
    const params = {
      page:       query.page,
      limit:      query.limit,
      search:     query.search?.trim() || undefined,
      medicineId: query.medicineId,
      inStock:    query.inStock,
      lowStock:   query.lowStock,
      nearExpiry: query.nearExpiry,
      status:     query.status,
    };
    const cacheKey = inventoryListKey(pharmacyId, params);
    const cached   = inventoryCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const result = await this.repo.list(pharmacyId, params);
    // Overlay BEFORE caching — cache key is pharmacy-scoped so cached entries
    // carry that pharmacy's effective rates.
    await this.applyMedicineOverrides(pharmacyId, result.items);
    inventoryCache.set(cacheKey, result, INVENTORY_CACHE_TTL_S);
    return result;
  }

  async getById(id: string, pharmacyId: string) {
    const item = await this.repo.getById(id, pharmacyId);
    if (!item) throw AppError.notFound("Inventory item not found");
    await this.applyMedicineOverrides(pharmacyId, [item]);
    return item;
  }

  async updateBatchStatus(id: string, pharmacyId: string, userId: string, input: UpdateBatchStatusInput) {
    return this.repo.updateBatchStatus(id, pharmacyId, userId, input.status, input.reason);
  }

  async adjustStock(id: string, pharmacyId: string, userId: string, input: AdjustStockInput) {
    return this.repo.adjustStock({ id, pharmacyId, userId, delta: input.delta, reason: input.reason, type: input.type });
  }

  async getLedger(pharmacyId: string, query: ListLedgerQuery) {
    return this.repo.getLedger(pharmacyId, {
      page:        query.page,
      limit:       query.limit,
      cursor:      query.cursor,
      inventoryId: query.inventoryId,
      medicineId:  query.medicineId,
      userId:      query.userId,
      type:        query.type,
      direction:   query.direction,
      from:        query.from ? new Date(query.from) : undefined,
      to:          query.to   ? new Date(query.to)   : undefined,
    });
  }

  // Unified alerts — runs only the requested type(s) in parallel.
  // Caller passes type="expiry"|"lowStock" to skip the unused query.
  async getAlerts(pharmacyId: string, type?: "expiry" | "lowStock") {
    const [expiry, lowStock] = await Promise.all([
      !type || type === "expiry"   ? this.repo.getExpiryAlerts(pharmacyId)  : Promise.resolve([]),
      !type || type === "lowStock" ? this.repo.getLowStockAlerts(pharmacyId) : Promise.resolve([]),
    ]);
    return { expiry, lowStock };
  }

  async upsertReservations(pharmacyId: string, input: ReserveStockInput) {
    return this.repo.upsertReservations({ pharmacyId, sessionId: input.sessionId, items: input.items });
  }

  async releaseReservations(pharmacyId: string, sessionId: string) {
    return this.repo.releaseReservations({ pharmacyId, sessionId });
  }

  async getFEFOBatch(medicineId: string, pharmacyId: string, quantity: number) {
    return this.repo.getFEFOBatch(medicineId, pharmacyId, quantity);
  }

  async updateLocation(id: string, pharmacyId: string, data: { shelfId?: string | null; location?: string | null }) {
    const item = await this.repo.getById(id, pharmacyId);
    if (!item) throw AppError.notFound("This stock item could not be found. It may have already been removed.");

    // Enforce mutual exclusivity: shelfId (structured) and location (free-text)
    // cannot both be set — they describe the same physical placement and conflict.
    // shelfId takes precedence when both are supplied.
    const update: { shelfId: string | null; location: string | null } =
      data.shelfId != null
        ? { shelfId: data.shelfId, location: null }
        : data.location != null
          ? { shelfId: null, location: data.location }
          : { shelfId: null, location: null };

    return this.repo.updateInventoryLocation(id, pharmacyId, update);
  }

  async batchRecall(pharmacyId: string, userId: string, input: BatchRecallInput) {
    const result = await this.repo.batchRecall(pharmacyId, userId, input);

    notifyOwners(this.app.prisma, pharmacyId, {
      subject: `🚨 URGENT: Batch Recall — ${input.batchNumber}`,
      message: `Batch ${input.batchNumber} has been recalled.\nReason: ${input.reason}\nAll affected inventory has been quarantined. Review immediately.`,
    }).catch((err) =>
      this.app.log.error(
        { err, pharmacyId, batchNumber: input.batchNumber },
        "Batch recall notification failed — owners may not have been alerted",
      )
    );

    return result;
  }

  async listRecalledBatches(pharmacyId: string, query: ListBatchRecallQuery) {
    return this.repo.listRecalledBatches(pharmacyId, query);
  }

  async calibrateMinimumStock(pharmacyId: string, dryRun: boolean) {
    return this.repo.calibrateMinimumStock(pharmacyId, dryRun);
  }
}
