import type { PrismaClient, Prisma, CustomerType } from "@pharmacy/database";

export class CustomersRepo {
  constructor(private db: PrismaClient) {}

  async create(tenantId: string, data: {
    name:         string;
    phone?:       string;
    email?:       string;
    address?:     string;
    age?:         number;
    gender?:      string;
    customerType: string;
    creditLimit:  number;
  }) {
    // Reject duplicate phone within same tenant
    if (data.phone) {
      const existing = await this.db.customer.findFirst({
        where: { tenantId, phone: data.phone },
      });
      if (existing) {
        throw Object.assign(
          new Error(`A customer with mobile ${data.phone} already exists`),
          { statusCode: 409 }
        );
      }
    }

    return this.db.customer.create({
      data: { tenantId, ...data, customerType: data.customerType as never },
    });
  }

  async update(id: string, tenantId: string, data: Partial<{
    name:         string;
    phone:        string;
    email:        string;
    address:      string;
    age:          number;
    gender:       string;
    customerType: string;
    creditLimit:  number;
  }>) {
    // If phone is changing, check for duplicate
    if (data.phone) {
      const duplicate = await this.db.customer.findFirst({
        where: { tenantId, phone: data.phone, NOT: { id } },
      });
      if (duplicate) {
        throw Object.assign(
          new Error(`Mobile ${data.phone} is already registered to another customer`),
          { statusCode: 409 }
        );
      }
    }

    const { customerType, ...rest } = data;
    return this.db.customer.update({
      where: { id },
      data: { ...rest, ...(customerType ? { customerType: customerType as CustomerType } : {}) },
    });
  }

  async getById(id: string, tenantId: string) {
    return this.db.customer.findFirst({
      where: { id, tenantId },
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

  async list(tenantId: string, params: {
    page:          number;
    limit:         number;
    search?:       string;
    customerType?: string;
  }) {
    const where: Prisma.CustomerWhereInput = {
      tenantId,
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
        include: {
          _count: { select: { invoices: true } },
        },
      }),
      this.db.customer.count({ where }),
    ]);

    return { items, total, page: params.page, limit: params.limit, totalPages: Math.ceil(total / params.limit) };
  }

  async delete(id: string, tenantId: string) {
    // Soft-check: can still delete if invoices exist — they keep the customerId (no FK cascade delete)
    const customer = await this.db.customer.findFirst({ where: { id, tenantId } });
    if (!customer) {
      throw Object.assign(new Error("Customer not found"), { statusCode: 404 });
    }
    return this.db.customer.delete({ where: { id } });
  }

  async getCreditSummary(id: string, tenantId: string) {
    const customer = await this.db.customer.findFirst({
      where:  { id, tenantId },
      select: { creditLimit: true, creditUsed: true, customerType: true },
    });
    if (!customer) {
      throw Object.assign(new Error("Customer not found"), { statusCode: 404 });
    }
    return {
      creditLimit:     customer.creditLimit,
      creditUsed:      customer.creditUsed,
      creditAvailable: customer.creditLimit > 0 ? customer.creditLimit - customer.creditUsed : null,
    };
  }
}
