import type { FastifyInstance } from "fastify";
import { SupplierPaymentsRepo } from "./supplier-payments.repo.js";
import type { CreatePaymentInput, ListPaymentQuery } from "./supplier-payments.schema.js";
import { AppError } from "../../lib/AppError.js";

export class SupplierPaymentsService {
  private repo: SupplierPaymentsRepo;

  constructor(app: FastifyInstance) {
    this.repo = new SupplierPaymentsRepo(app.prisma);
  }

  async create(pharmacyId: string, userId: string, input: CreatePaymentInput) {
    return this.repo.create(pharmacyId, userId, {
      supplierId:  input.supplierId,
      grnId:       input.grnId,
      amount:      input.amount,
      paymentMode: input.paymentMode,
      reference:   input.reference,
      notes:       input.notes,
      paidAt:      input.paidAt ? new Date(input.paidAt) : undefined,
    });
  }

  async getById(id: string, pharmacyId: string) {
    const payment = await this.repo.getById(id, pharmacyId);
    if (!payment) throw AppError.notFound("Payment not found");
    return payment;
  }

  async list(pharmacyId: string, query: ListPaymentQuery) {
    return this.repo.list(pharmacyId, {
      page:       query.page,
      limit:      query.limit,
      supplierId: query.supplierId,
      grnId:      query.grnId,
      from:       query.from ? new Date(query.from) : undefined,
      to:         query.to   ? new Date(query.to)   : undefined,
    });
  }

  async getSupplierBalance(supplierId: string, pharmacyId: string) {
    return this.repo.getSupplierBalance(supplierId, pharmacyId);
  }
}
