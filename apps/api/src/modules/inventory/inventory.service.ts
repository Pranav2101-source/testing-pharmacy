import type { FastifyInstance } from "fastify";
import { InventoryRepo } from "./inventory.repo.js";
import type { AddStockInput } from "./inventory.schema.js";

export class InventoryService {
  private repo: InventoryRepo;

  constructor(app: FastifyInstance) {
    this.repo = new InventoryRepo(app.prisma);
  }

  async addStock(tenantId: string, input: AddStockInput) {
    return this.repo.upsertBatch(tenantId, {
      ...input,
      expiryDate: new Date(input.expiryDate),
    });
  }

  async list(tenantId: string, query: Record<string, string>) {
    return this.repo.list(tenantId, {
      page: Number(query["page"] ?? 1),
      limit: Number(query["limit"] ?? 20),
      search: query["search"],
      medicineId: query["medicineId"],
      inStock: query["inStock"] === "true",
      lowStock: query["lowStock"] === "true",
      nearExpiry: query["nearExpiry"] === "true",
    });
  }

  async getById(id: string, tenantId: string) {
    const item = await this.repo.getById(id, tenantId);
    if (!item) throw { statusCode: 404, message: "Inventory item not found" };
    return item;
  }

  async getExpiryAlerts(tenantId: string) {
    return this.repo.getExpiryAlerts(tenantId);
  }

  async getLowStockAlerts(tenantId: string) {
    return this.repo.getLowStockAlerts(tenantId);
  }
}
