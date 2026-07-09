import type { Db, Prisma, CustomerType } from "@pharmacy/database";
import { AppError } from "../../lib/AppError.js";

type CustomerWriteData = {
  name:            string;
  phone?:          string;
  email?:          string;
  address?:        string;
  dateOfBirth?:    string; // "YYYY-MM-DD" — converted to Date before writing
  gender?:         string;
  abhaNumber?:     string;
  cardNumber?:     string;
  customerType:    string;
  defaultDiscount: number;
  creditLimit:     number;
  notes?:          string;
  createdById?:    string;
};

// Returns current age in full years, or null if dateOfBirth is not set.
export function computeAge(dateOfBirth: Date | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const today = new Date();
  let age = today.getFullYear() - dateOfBirth.getFullYear();
  const m = today.getMonth() - dateOfBirth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dateOfBirth.getDate())) age--;
  return age < 0 ? 0 : age;
}

// Reusable filter that excludes soft-deleted customers from all queries
const ACTIVE = { deletedAt: null } as const;

function parseDate(iso?: string): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? undefined : d;
}

export class CustomersRepo {
  constructor(private db: Db) {}

  async create(pharmacyId: string, data: CustomerWriteData) {
    if (data.phone) {
      const dup = await this.db.customer.findFirst({
        where: { pharmacyId, phone: data.phone, ...ACTIVE },
      });
      if (dup) throw AppError.conflict(`A customer with mobile ${data.phone} already exists`);
    }

    if (data.abhaNumber) {
      const dup = await this.db.customer.findFirst({
        where: { pharmacyId, abhaNumber: data.abhaNumber, ...ACTIVE },
      });
      if (dup) throw AppError.conflict(`A customer with ABHA number ${data.abhaNumber} already exists`);
    }

    if (data.cardNumber) {
      const dup = await this.db.customer.findFirst({
        where: { pharmacyId, cardNumber: data.cardNumber, ...ACTIVE },
      });
      if (dup) throw AppError.conflict(`Card number ${data.cardNumber} is already assigned to another customer`);
    }

    const { dateOfBirth, customerType, ...rest } = data;
    return this.db.customer.create({
      data: {
        pharmacyId,
        ...rest,
        customerType:    customerType as CustomerType,
        dateOfBirth:     parseDate(dateOfBirth),
        defaultDiscount: rest.defaultDiscount ?? 0,
      },
    });
  }

  async update(id: string, pharmacyId: string, data: Partial<Omit<CustomerWriteData, "createdById">>) {
    if (data.phone) {
      const dup = await this.db.customer.findFirst({
        where: { pharmacyId, phone: data.phone, NOT: { id }, ...ACTIVE },
      });
      if (dup) throw AppError.conflict(`Mobile ${data.phone} is already registered to another customer`);
    }

    if (data.abhaNumber) {
      const dup = await this.db.customer.findFirst({
        where: { pharmacyId, abhaNumber: data.abhaNumber, NOT: { id }, ...ACTIVE },
      });
      if (dup) throw AppError.conflict(`ABHA number ${data.abhaNumber} is already assigned to another customer`);
    }

    if (data.cardNumber) {
      const dup = await this.db.customer.findFirst({
        where: { pharmacyId, cardNumber: data.cardNumber, NOT: { id }, ...ACTIVE },
      });
      if (dup) throw AppError.conflict(`Card number ${data.cardNumber} is already assigned to another customer`);
    }

    const { customerType, dateOfBirth, ...rest } = data;
    return this.db.customer.update({
      where: { id, pharmacyId, deletedAt: null },
      data:  {
        ...rest,
        ...(customerType !== undefined ? { customerType: customerType as CustomerType } : {}),
        ...(dateOfBirth !== undefined  ? { dateOfBirth: parseDate(dateOfBirth) ?? null } : {}),
      },
    });
  }

  async getById(id: string, pharmacyId: string) {
    return this.db.customer.findFirst({
      where:   { id, pharmacyId, ...ACTIVE },
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
      ...ACTIVE,
      ...(params.customerType ? { customerType: params.customerType as CustomerType } : {}),
      ...(params.search
        ? {
            OR: [
              { name:       { contains: params.search, mode: "insensitive" } },
              { phone:      { contains: params.search, mode: "insensitive" } },
              { email:      { contains: params.search, mode: "insensitive" } },
              { abhaNumber: { contains: params.search, mode: "insensitive" } },
              { cardNumber: { contains: params.search, mode: "insensitive" } },
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

  // Fast search optimised for the billing combobox — returns lightweight projection only.
  // Phone-digit queries bubble phone-prefix matches to the top for pharmacist speed.
  async search(pharmacyId: string, q: string, limit: number) {
    const trimmed = q.trim();
    const isDigit = /^\d+$/.test(trimmed);

    const where: Prisma.CustomerWhereInput = {
      pharmacyId,
      ...ACTIVE,
      OR: [
        { phone:      { startsWith: trimmed, mode: "insensitive" } },
        { name:       { contains:   trimmed, mode: "insensitive" } },
        { abhaNumber: { contains:   trimmed, mode: "insensitive" } },
        { cardNumber: { contains:   trimmed, mode: "insensitive" } },
        ...(!isDigit ? [{ email: { contains: trimmed, mode: "insensitive" as const } }] : []),
      ],
    };

    return this.db.customer.findMany({
      where,
      take:    limit,
      orderBy: isDigit ? { phone: "asc" } : { name: "asc" },
      select:  {
        id:              true,
        name:            true,
        phone:           true,
        email:           true,
        address:         true,
        customerType:    true,
        defaultDiscount: true,
        creditLimit:     true,
        creditUsed:      true,
        abhaNumber:      true,
        cardNumber:      true,
      },
    });
  }

  async softDelete(id: string, pharmacyId: string) {
    const customer = await this.db.customer.findFirst({ where: { id, pharmacyId, ...ACTIVE } });
    if (!customer) throw AppError.notFound("Customer not found");

    return this.db.customer.update({
      where: { id, pharmacyId },
      data:  { deletedAt: new Date() },
    });
  }

  async getCreditSummary(id: string, pharmacyId: string) {
    const customer = await this.db.customer.findFirst({
      where:  { id, pharmacyId, ...ACTIVE },
      select: { creditLimit: true, creditUsed: true, customerType: true },
    });
    if (!customer) throw AppError.notFound("Customer not found");

    return {
      creditLimit:     customer.creditLimit,
      creditUsed:      customer.creditUsed,
      creditAvailable: customer.creditLimit > 0 ? customer.creditLimit - customer.creditUsed : null,
    };
  }

  // Receivables — customers who currently owe money (credit sales not fully paid).
  // creditUsed is maintained on the Customer record as credit invoices are raised
  // and paid, so this is a single indexed scan, highest dues first.
  async listOutstanding(pharmacyId: string) {
    const customers = await this.db.customer.findMany({
      where:   { pharmacyId, ...ACTIVE, creditUsed: { gt: 0 } },
      select:  { id: true, name: true, phone: true, customerType: true, creditUsed: true, creditLimit: true },
      orderBy: { creditUsed: "desc" },
    });
    const totalOutstanding = customers.reduce((sum, c) => sum + Number(c.creditUsed), 0);
    return { customers, totalOutstanding, count: customers.length };
  }
}
