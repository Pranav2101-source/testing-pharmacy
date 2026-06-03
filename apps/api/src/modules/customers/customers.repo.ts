import type { PrismaClient, Prisma, CustomerType } from "@pharmacy/database";
import { AppError } from "../../lib/AppError.js";

export class CustomersRepo {
  constructor(private db: PrismaClient) {}

  async create(pharmacyId: string, data: {
    name:         string;
    phone?:       string;
    email?:       string;
    address?:     string;
    age?:         number;
    gender?:      string;
    customerType: string;
    creditLimit:  number;
  }) {
    if (data.phone) {
      const existing = await this.db.customer.findFirst({
        where: { pharmacyId, phone: data.phone },
      });
      if (existing) {
        throw AppError.conflict(`A customer with mobile ${data.phone} already exists`);
      }
    }

    return this.db.customer.create({
      data: { pharmacyId, ...data, customerType: data.customerType as never },
    });
  }

  async update(id: string, pharmacyId: string, data: Partial<{
    name:         string;
    phone:        string;
    email:        string;
    address:      string;
    age:          number;
    gender:       string;
    customerType: string;
    creditLimit:  number;
  }>) {
    if (data.phone) {
      const duplicate = await this.db.customer.findFirst({
        where: { pharmacyId, phone: data.phone, NOT: { id } },
      });
      if (duplicate) {
        throw AppError.conflict(`Mobile ${data.phone} is already registered to another customer`);
      }
    }

    const { customerType, ...rest } = data;
    return this.db.customer.update({
      where: { id, pharmacyId },  // pharmacyId scopes the update — cross-tenant modification impossible
      data:  { ...rest, ...(customerType ? { customerType: customerType as CustomerType } : {}) },
    });
  }

  async getById(id: string, pharmacyId: string) {
    return this.db.customer.findFirst({
      where:   { id, pharmacyId },
      include: {
        invoices: {
          where:   { isCancelled: false },
          orderBy: { createdAt: "desc" },
          take:    10,
          select:  { id: true, invoiceNumber: true, totalAmount: true, paymentStatus: true, createdAt: true },
        },
      },
    });
  }

  async list(pharmacyId: string, params: {
    page:          number;
    limit:         number;
    search?:       string;
    customerType?: string;
  }) {
    const where: Prisma.CustomerWhereInput = {
      pharmacyId,
      ...(params.customerType ? { customerType: params.customerType as never } : {}),
      ...(params.search
        ? {
            OR: [
              { name:  { contains: params.search, mode: "insensitive" } },
              { phone: { contains: params.search, mode: "insensitive" } },
              { email: { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.customer.findMany({
        where,
        orderBy: { name: "asc" },
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
        include: { _count: { select: { invoices: true } } },
      }),
      this.db.customer.count({ where }),
    ]);

    return {
      items,
      total,
      page:       params.page,
      limit:      params.limit,
      totalPages: Math.ceil(total / params.limit),
    };
  }

  async delete(id: string, pharmacyId: string) {
    const customer = await this.db.customer.findFirst({ where: { id, pharmacyId } });
    if (!customer) throw AppError.notFound("Customer not found");

    // pharmacyId scopes the delete — prevents cross-tenant deletion
    return this.db.customer.delete({ where: { id, pharmacyId } });
  }

  async getCreditSummary(id: string, pharmacyId: string) {
    const customer = await this.db.customer.findFirst({
      where:  { id, pharmacyId },
      select: { creditLimit: true, creditUsed: true, customerType: true },
    });
    if (!customer) throw AppError.notFound("Customer not found");

    return {
      creditLimit:     customer.creditLimit,
      creditUsed:      customer.creditUsed,
      creditAvailable: customer.creditLimit > 0 ? customer.creditLimit - customer.creditUsed : null,
    };
  }
}
