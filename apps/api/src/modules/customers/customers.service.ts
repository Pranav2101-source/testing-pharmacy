import type { FastifyInstance } from "fastify";
import { CustomersRepo } from "./customers.repo.js";
import type { CreateCustomerInput, UpdateCustomerInput, ListCustomersQuery } from "./customers.schema.js";

const MAX_PAGE_LIMIT = 100;

export class CustomersService {
  private repo: CustomersRepo;

  constructor(app: FastifyInstance) {
    this.repo = new CustomersRepo(app.prisma);
  }

  async create(pharmacyId: string, input: CreateCustomerInput) {
    return this.repo.create(pharmacyId, {
      name:         input.name,
      phone:        input.phone,
      email:        input.email,
      address:      input.address,
      age:          input.age,
      gender:       input.gender,
      customerType: input.customerType,
      creditLimit:  input.creditLimit,
    });
  }

  async update(id: string, pharmacyId: string, input: UpdateCustomerInput) {
    return this.repo.update(id, pharmacyId, {
      name:         input.name,
      phone:        input.phone,
      email:        input.email,
      address:      input.address,
      age:          input.age,
      gender:       input.gender,
      customerType: input.customerType,
      creditLimit:  input.creditLimit,
    });
  }

  async getById(id: string, pharmacyId: string) {
    const customer = await this.repo.getById(id, pharmacyId);
    if (!customer) {
      const err = new Error("Customer not found");
      (err as any).statusCode = 404;
      throw err;
    }
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

  async delete(id: string, pharmacyId: string) {
    return this.repo.delete(id, pharmacyId);
  }

  async getCreditSummary(id: string, pharmacyId: string) {
    return this.repo.getCreditSummary(id, pharmacyId);
  }
}
