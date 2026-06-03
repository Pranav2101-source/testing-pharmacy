import type { FastifyInstance } from "fastify";
import { SupplierReturnsRepo } from "./supplier-returns.repo.js";
import type { CreateSRInput, ListSRQuery } from "./supplier-returns.schema.js";
import { AppError } from "../../lib/AppError.js";

export class SupplierReturnsService {
  private repo: SupplierReturnsRepo;

  constructor(app: FastifyInstance) {
    this.repo = new SupplierReturnsRepo(app.prisma);
  }

  async create(pharmacyId: string, userId: string, input: CreateSRInput) {
    const items = input.items.map((item) => ({
      inventoryId:  item.inventoryId,
      medicineId:   item.medicineId,
      medicineName: item.medicineName,
      batchNumber:  item.batchNumber,
      expiryDate:   new Date(item.expiryDate),
      quantity:     item.quantity,
      purchaseRate: item.purchaseRate,
      amount:       parseFloat((item.purchaseRate * item.quantity).toFixed(2)),
      reason:       item.reason,
    }));

    const totalAmount = parseFloat(items.reduce((s, i) => s + i.amount, 0).toFixed(2));

    return this.repo.create(pharmacyId, userId, {
      supplierId:  input.supplierId,
      debitNoteNo: input.debitNoteNo,
      notes:       input.notes,
      items,
      totalAmount,
    });
  }

  async confirm(id: string, pharmacyId: string, userId: string) {
    return this.repo.confirm(id, pharmacyId, userId);
  }

  async cancel(id: string, pharmacyId: string, userId: string) {
    return this.repo.cancel(id, pharmacyId, userId);
  }

  async getById(id: string, pharmacyId: string) {
    const sr = await this.repo.getById(id, pharmacyId);
    if (!sr) throw AppError.notFound("Supplier return not found");
    return sr;
  }

  async list(pharmacyId: string, query: ListSRQuery) {
    return this.repo.list(pharmacyId, {
      page:       query.page,
      limit:      query.limit,
      status:     query.status,
      supplierId: query.supplierId,
      from:       query.from ? new Date(query.from) : undefined,
      to:         query.to   ? new Date(query.to)   : undefined,
    });
  }
}
