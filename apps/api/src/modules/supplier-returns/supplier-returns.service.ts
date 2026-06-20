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
      // Compute line-level GST breakdown for the debit note.
      // taxableAmount = purchaseRate × qty (no discount on supplier returns)
      // cgst = sgst = taxableAmount × gstRate / 2 / 100 (intra-state; igst for inter-state handled at header)
      const taxableAmount = parseFloat((item.purchaseRate * item.quantity).toFixed(2));
      const gstRate       = item.gstRate;
      const halfGst       = parseFloat((taxableAmount * gstRate / 100 / 2).toFixed(2));
      const cgst          = halfGst;
      const sgst          = halfGst;
      const igst          = 0; // set at header level if inter-state; line items always use cgst+sgst
      const amount        = parseFloat((taxableAmount + cgst + sgst).toFixed(2));
      return {
        inventoryId:  item.inventoryId,
        medicineId:   item.medicineId,
        medicineName: item.medicineName,
        batchNumber:  item.batchNumber,
        expiryDate:   new Date(item.expiryDate),
        quantity:     item.quantity,
        purchaseRate: item.purchaseRate,
        taxableAmount,
        gstRate,
        cgst,
        sgst,
        igst,
        amount,
        reason: item.reason,
      };
    });

    const subtotal      = parseFloat(items.reduce((s, i) => s + i.taxableAmount, 0).toFixed(2));
    const totalCgst     = parseFloat(items.reduce((s, i) => s + i.cgst, 0).toFixed(2));
    const totalSgst     = parseFloat(items.reduce((s, i) => s + i.sgst, 0).toFixed(2));
    const totalGst      = parseFloat((totalCgst + totalSgst).toFixed(2));
    const totalAmount   = parseFloat((subtotal + totalGst).toFixed(2));

    const seq          = await nextSequenceValue(this.app.prisma, pharmacyId, "SUPPLIER_RETURN");
    const returnNumber = generateSRNumber(seq);

    return this.repo.create(pharmacyId, userId, {
      returnNumber,
      supplierId:    input.supplierId,
      debitNoteNo:   input.debitNoteNo,
      notes:         input.notes,
      items,
      subtotal,
      taxableAmount: subtotal,
      cgst:          totalCgst,
      sgst:          totalSgst,
      igst:          0,
      totalGst,
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
