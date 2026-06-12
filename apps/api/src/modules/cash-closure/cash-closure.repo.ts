import type { Db } from "@pharmacy/database";
import type { ListCashClosureQuery } from "./cash-closure.schema.js";

export class CashClosureRepo {
  constructor(private db: Db) {}

  // Compute today's sales breakdown from invoices for a given IST date
  salesBreakdown(pharmacyId: string, from: Date, to: Date) {
    return this.db.invoice.groupBy({
      by:    ["paymentMode"],
      where: { pharmacyId, isCancelled: false, createdAt: { gte: from, lte: to } },
      _sum:  { totalAmount: true },
    });
  }

  list(pharmacyId: string, query: ListCashClosureQuery) {
    const { from, to, status, page, limit } = query;
    const skip = (page - 1) * limit;
    const where = {
      pharmacyId,
      ...(status ? { status } : {}),
      ...(from || to
        ? {
            closureDate: {
              ...(from ? { gte: from } : {}),
              ...(to   ? { lte: to }   : {}),
            },
          }
        : {}),
    };
    return Promise.all([
      this.db.cashClosure.findMany({
        where,
        include: { user: { select: { id: true, name: true } } },
        orderBy: { closureDate: "desc" },
        skip,
        take: limit,
      }),
      this.db.cashClosure.count({ where }),
    ]);
  }

  findByDate(pharmacyId: string, closureDate: string) {
    return this.db.cashClosure.findUnique({ where: { pharmacyId_closureDate: { pharmacyId, closureDate } } });
  }

  findById(id: string, pharmacyId: string) {
    return this.db.cashClosure.findFirst({
      where:   { id, pharmacyId },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  create(data: {
    pharmacyId:   string;
    userId:       string;
    closureDate:  string;
    openingCash:  number;
    cashSales:    number;
    upiSales:     number;
    cardSales:    number;
    creditSales:  number;
    walletSales:  number;
    expectedCash: number;
    actualCash:   number;
    variance:     number;
    notes?:       string;
  }) {
    return this.db.cashClosure.create({ data });
  }

  update(id: string, data: {
    openingCash?:  number;
    cashSales?:    number;
    upiSales?:     number;
    cardSales?:    number;
    creditSales?:  number;
    walletSales?:  number;
    expectedCash?: number;
    actualCash?:   number;
    variance?:     number;
    notes?:        string;
    status?:       "DRAFT" | "CLOSED" | "DISPUTED";
    closedAt?:     Date | null;
  }) {
    return this.db.cashClosure.update({ where: { id }, data });
  }
}
