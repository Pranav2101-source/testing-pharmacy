import type { FastifyInstance } from "fastify";
import { SupplierReturnsRepo } from "./supplier-returns.repo.js";
import type { CreateSRInput, ListSRQuery } from "./supplier-returns.schema.js";
import { AppError } from "../../lib/AppError.js";
import { generateSRNumber } from "../billing/billing.constants.js";
import { nextSequenceValue } from "../../lib/sequences.js";

export class SupplierReturnsService {
  private repo: SupplierReturnsRepo;

  constructor(private app: FastifyInstance) {
    this.repo = new SupplierReturnsRepo(app.prisma);
  }

  async create(pharmacyId: string, userId: string, input: CreateSRInput) {
    const items = input.items.map((item) => {
      // A valid debit note must include GST so the supplier can issue a
      // corresponding credit note and the pharmacy can reverse its ITC.
      // amount = purchaseRate × qty × (1 + gstRate/100)
      const taxMultiplier = 1 + item.gstRate / 100;
      const amount = parseFloat((item.purchaseRate * item.quantity * taxMultiplier).toFixed(2));
      return {
        inventoryId:  item.inventoryId,
        medicineId:   item.medicineId,
        medicineName: item.medicineName,
        batchNumber:  item.batchNumber,
        expiryDate:   new Date(item.expiryDate),
        quantity:     item.quantity,
        purchaseRate: item.purchaseRate,
        amount,
        reason:       item.reason,
      };
    });

    const totalAmount = parseFloat(items.reduce((s, i) => s + i.amount, 0).toFixed(2));

    // Return number from the durable Postgres counter — race-safe, survives Redis restarts.
    const seq          = await nextSequenceValue(this.app.prisma, pharmacyId, "SUPPLIER_RETURN");
    const returnNumber = generateSRNumber(seq);

    return this.repo.create(pharmacyId, userId, {
      returnNumber,
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
