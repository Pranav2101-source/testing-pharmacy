import type { FastifyInstance } from "fastify";
import { QuotationsRepo } from "./quotations.repo.js";
import type { CreateQuotationInput, UpdateQuotationInput, ListQuotationQuery, CompareQuotationsInput } from "./quotations.schema.js";
import { AppError } from "../../lib/AppError.js";

export class QuotationsService {
  private repo: QuotationsRepo;

  constructor(app: FastifyInstance) {
    this.repo = new QuotationsRepo(app.prisma);
  }

  async create(pharmacyId: string, userId: string, input: CreateQuotationInput) {
    return this.repo.create(pharmacyId, userId, {
      supplierId: input.supplierId,
      validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
      notes:      input.notes,
      items:      input.items,
    });
  }

  async update(id: string, pharmacyId: string, userId: string, input: UpdateQuotationInput) {
    return this.repo.update(id, pharmacyId, userId, {
      validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
      notes:      input.notes,
      items:      input.items,
    });
  }

  async markSent(id: string, pharmacyId: string, userId: string) {
    return this.repo.updateStatus(id, pharmacyId, userId, "SENT");
  }

  async markReceived(id: string, pharmacyId: string, userId: string) {
    return this.repo.updateStatus(id, pharmacyId, userId, "RECEIVED");
  }

  async markExpired(id: string, pharmacyId: string, userId: string) {
    return this.repo.updateStatus(id, pharmacyId, userId, "EXPIRED");
  }

  async getById(id: string, pharmacyId: string) {
    const q = await this.repo.getById(id, pharmacyId);
    if (!q) throw AppError.notFound("Quotation not found");
    return q;
  }

  async list(pharmacyId: string, query: ListQuotationQuery) {
    return this.repo.list(pharmacyId, {
      page:       query.page,
      limit:      query.limit,
      supplierId: query.supplierId,
      status:     query.status,
      from:       query.from ? new Date(query.from) : undefined,
      to:         query.to   ? new Date(query.to)   : undefined,
    });
  }

  async compare(pharmacyId: string, input: CompareQuotationsInput) {
    return this.repo.compare(pharmacyId, input.quotationIds);
  }

  async convertToPO(id: string, pharmacyId: string, userId: string, notes?: string) {
    return this.repo.convertToPO(id, pharmacyId, userId, notes);
  }
}
