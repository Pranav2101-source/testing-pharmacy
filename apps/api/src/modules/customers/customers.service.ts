import type { FastifyInstance } from "fastify";
import { CustomersRepo } from "./customers.repo.js";
import type { CreateCustomerInput, UpdateCustomerInput, ListCustomersQuery } from "./customers.schema.js";

const MAX_PAGE_LIMIT = 100;

export class CustomersService {
  private repo: CustomersRepo;

  constructor(app: FastifyInstance) {
    this.repo = new CustomersRepo(app.prisma);
  }

  async create(tenantId: string, input: CreateCustomerInput) {
    return this.repo.create(tenantId, {
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

  async update(id: string, tenantId: string, input: UpdateCustomerInput) {
    const customer = await this.repo.getById(id, tenantId);
    if (!customer) {
      throw Object.assign(new Error("Customer not found"), { statusCode: 404 });
    }
    return this.repo.update(id, tenantId, {
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

  async getById(id: string, tenantId: string) {
    const customer = await this.repo.getById(id, tenantId);
    if (!customer) {
      throw Object.assign(new Error("Customer not found"), { statusCode: 404 });
    }
    return customer;
  }

  async list(tenantId: string, query: ListCustomersQuery) {
    const page  = Math.max(1, query.page);
    const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, query.limit));

    return this.repo.list(tenantId, {
      page,
      limit,
      search:       query.search?.trim() || undefined,
      customerType: query.customerType,
    });
  }

  async delete(id: string, tenantId: string) {
    return this.repo.delete(id, tenantId);
  }

  async getCreditSummary(id: string, tenantId: string) {
    return this.repo.getCreditSummary(id, tenantId);
  }
}
