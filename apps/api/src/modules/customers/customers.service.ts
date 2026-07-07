import type { FastifyInstance } from "fastify";
import { CustomersRepo } from "./customers.repo.js";
import { AppError } from "../../lib/AppError.js";
import type {
  CreateCustomerInput,
  UpdateCustomerInput,
  ListCustomersQuery,
  SearchCustomersQuery,
} from "./customers.schema.js";

const MAX_PAGE_LIMIT = 100;

export class CustomersService {
  private repo: CustomersRepo;

  constructor(app: FastifyInstance) {
    this.repo = new CustomersRepo(app.prisma);
  }

  async create(pharmacyId: string, input: CreateCustomerInput, createdById?: string) {
    return this.repo.create(pharmacyId, {
      name:            input.name,
      phone:           input.phone,
      email:           input.email,
      address:         input.address,
      dateOfBirth:     input.dateOfBirth,
      gender:          input.gender,
      abhaNumber:      input.abhaNumber,
      cardNumber:      input.cardNumber,
      customerType:    input.customerType,
      defaultDiscount: input.defaultDiscount,
      creditLimit:     input.creditLimit,
      notes:           input.notes,
      createdById,
    });
  }

  async update(id: string, pharmacyId: string, input: UpdateCustomerInput) {
    return this.repo.update(id, pharmacyId, {
      name:            input.name,
      phone:           input.phone,
      email:           input.email,
      address:         input.address,
      dateOfBirth:     input.dateOfBirth,
      gender:          input.gender,
      abhaNumber:      input.abhaNumber,
      cardNumber:      input.cardNumber,
      customerType:    input.customerType,
      defaultDiscount: input.defaultDiscount,
      creditLimit:     input.creditLimit,
      notes:           input.notes,
    });
  }

  async getById(id: string, pharmacyId: string) {
    const customer = await this.repo.getById(id, pharmacyId);
    if (!customer) throw AppError.notFound("Customer not found");
    return customer;
  }

  async list(pharmacyId: string, query: ListCustomersQuery) {
    return this.repo.list(pharmacyId, {
      page:         Math.max(1, query.page),
      limit:        Math.min(MAX_PAGE_LIMIT, Math.max(1, query.limit)),
      search:       query.search?.trim() || undefined,
      customerType: query.customerType,
    });
  }

  async search(pharmacyId: string, query: SearchCustomersQuery) {
    const items = await this.repo.search(pharmacyId, query.q, Math.min(20, query.limit));
    return { items };
  }

  async delete(id: string, pharmacyId: string) {
    return this.repo.softDelete(id, pharmacyId);
  }

  async getCreditSummary(id: string, pharmacyId: string) {
    return this.repo.getCreditSummary(id, pharmacyId);
  }

  async listOutstanding(pharmacyId: string) {
    return this.repo.listOutstanding(pharmacyId);
  }
}
