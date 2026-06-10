import type { FastifyInstance } from "fastify";
import { InventoryRepo } from "./inventory.repo.js";
import type {
  AddStockInput, AdjustStockInput, ReserveStockInput,
  UpdateBatchStatusInput, ListInventoryQuery, ListLedgerQuery,
  BatchRecallInput, ListBatchRecallQuery,
} from "./inventory.schema.js";
import { AppError } from "../../lib/AppError.js";
import { notifyOwners } from "../../lib/notifications.js";

// Inventory changes on every sale (billing tx updates the DB directly, bypassing
// this service), so we use a short TTL-only cache — no explicit invalidation.
// 30 seconds keeps the list practically current while preventing redundant hits
// when staff refresh the inventory screen between sales.
const INVENTORY_CACHE_TTL_S = 30;
const inventoryListKey = (pharmacyId: string, params: object) =>
  `inventory:list:${pharmacyId}:${JSON.stringify(params)}`;

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
    const cached   = await this.app.redis.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch { /* corrupt — fall through */ }
    }
    const result = await this.repo.list(pharmacyId, params);
    await this.app.redis.set(cacheKey, JSON.stringify(result), "EX", INVENTORY_CACHE_TTL_S);
    return result;
  }

  async getById(id: string, pharmacyId: string) {
    const item = await this.repo.getById(id, pharmacyId);
    if (!item) throw AppError.notFound("Inventory item not found");
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
      inventoryId: query.inventoryId,
      medicineId:  query.medicineId,
      type:        query.type,
      direction:   query.direction,
      from:        query.from ? new Date(query.from) : undefined,
      to:          query.to   ? new Date(query.to)   : undefined,
    });
  }

  async getExpiryAlerts(pharmacyId: string) {
    return this.repo.getExpiryAlerts(pharmacyId);
  }

  async getLowStockAlerts(pharmacyId: string) {
    return this.repo.getLowStockAlerts(pharmacyId);
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
    const item = await this.repo.db.inventory.findFirst({ where: { id, pharmacyId }, select: { id: true } });
    if (!item) throw AppError.notFound("This stock item could not be found. It may have already been removed.");
    return this.repo.db.inventory.update({
      where: { id, pharmacyId },
      data:  { shelfId: data.shelfId, location: data.location },
    });
  }

  async batchRecall(pharmacyId: string, userId: string, input: BatchRecallInput) {
    const result = await this.repo.batchRecall(pharmacyId, userId, input);

    void notifyOwners(this.repo.db, pharmacyId, {
      subject: `🚨 URGENT: Batch Recall — ${input.batchNumber}`,
      message: `Batch ${input.batchNumber} has been recalled.\nReason: ${input.reason}\nAll affected inventory has been quarantined. Review immediately.`,
    });

    return result;
  }

  async listRecalledBatches(pharmacyId: string, query: ListBatchRecallQuery) {
    return this.repo.listRecalledBatches(pharmacyId, query);
  }
}
