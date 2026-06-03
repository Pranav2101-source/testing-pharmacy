import type { FastifyInstance } from "fastify";
import { SupplierCreditNotesRepo } from "./supplier-credit-notes.repo.js";
import type { CreateCreditNoteInput, UpdateCreditNoteStatusInput, ListCreditNoteQuery } from "./supplier-credit-notes.schema.js";
import { AppError } from "../../lib/AppError.js";

export class SupplierCreditNotesService {
  private repo: SupplierCreditNotesRepo;

  constructor(app: FastifyInstance) {
    this.repo = new SupplierCreditNotesRepo(app.prisma);
  }

  async create(pharmacyId: string, userId: string, input: CreateCreditNoteInput) {
    return this.repo.create(pharmacyId, userId, {
      supplierId:       input.supplierId,
      supplierReturnId: input.supplierReturnId,
      amount:           input.amount,
      notes:            input.notes,
      issuedAt:         input.issuedAt ? new Date(input.issuedAt) : undefined,
    });
  }

  async updateStatus(id: string, pharmacyId: string, userId: string, input: UpdateCreditNoteStatusInput) {
    return this.repo.updateStatus(id, pharmacyId, userId, input.status, input.notes);
  }

  async getById(id: string, pharmacyId: string) {
    const cn = await this.repo.getById(id, pharmacyId);
    if (!cn) throw AppError.notFound("Credit note not found");
    return cn;
  }

  async list(pharmacyId: string, query: ListCreditNoteQuery) {
    return this.repo.list(pharmacyId, {
      page:       query.page,
      limit:      query.limit,
      supplierId: query.supplierId,
      status:     query.status,
      from:       query.from ? new Date(query.from) : undefined,
      to:         query.to   ? new Date(query.to)   : undefined,
    });
  }
}
