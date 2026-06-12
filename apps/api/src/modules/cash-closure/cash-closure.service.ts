import type { FastifyInstance } from "fastify";
import { CashClosureRepo } from "./cash-closure.repo.js";
import { AppError } from "../../lib/AppError.js";
import type {
  CreateCashClosureInput,
  UpdateCashClosureInput,
  CloseCashClosureInput,
  ListCashClosureQuery,
} from "./cash-closure.schema.js";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDayBounds(dateStr: string): { from: Date; to: Date } {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const from = new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
  const to   = new Date(from.getTime() + 86400_000 - 1);
  return { from, to };
}

function todayIST(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export class CashClosureService {
  private repo: CashClosureRepo;

  constructor(app: FastifyInstance) {
    this.repo = new CashClosureRepo(app.prisma);
  }

  async list(pharmacyId: string, query: ListCashClosureQuery) {
    const [closures, total] = await this.repo.list(pharmacyId, query);
    return {
      data:  closures.map(normalise),
      total,
      page:  query.page,
      limit: query.limit,
      pages: Math.ceil(total / query.limit),
    };
  }

  async getById(id: string, pharmacyId: string) {
    const c = await this.repo.findById(id, pharmacyId);
    if (!c) throw new AppError("Cash closure not found", 404);
    return normalise(c);
  }

  async initForDate(pharmacyId: string, userId: string, input: CreateCashClosureInput) {
    const closureDate = input.closureDate ?? todayIST();
    const existing    = await this.repo.findByDate(pharmacyId, closureDate);
    if (existing) throw new AppError(`A cash closure for ${closureDate} already exists`, 409);

    const { from, to } = istDayBounds(closureDate);
    const breakdown    = await this.repo.salesBreakdown(pharmacyId, from, to);

    let cashSales = 0, upiSales = 0, cardSales = 0, creditSales = 0, walletSales = 0;
    for (const row of breakdown) {
      const amt = Number(row._sum.totalAmount ?? 0);
      switch (row.paymentMode) {
        case "CASH":   cashSales   = amt; break;
        case "UPI":    upiSales    = amt; break;
        case "CARD":   cardSales   = amt; break;
        case "CREDIT": creditSales = amt; break;
        case "WALLET": walletSales = amt; break;
      }
    }

    const expectedCash = input.openingCash + cashSales;
    const variance     = input.actualCash - expectedCash;

    const closure = await this.repo.create({
      pharmacyId,
      userId,
      closureDate,
      openingCash:  input.openingCash,
      cashSales,
      upiSales,
      cardSales,
      creditSales,
      walletSales,
      expectedCash,
      actualCash:   input.actualCash,
      variance,
      notes:        input.notes,
    });

    return normalise(closure);
  }

  async update(id: string, pharmacyId: string, input: UpdateCashClosureInput) {
    const existing = await this.repo.findById(id, pharmacyId);
    if (!existing) throw new AppError("Cash closure not found", 404);
    if (existing.status === "CLOSED") throw new AppError("Cannot edit a closed cash closure", 409);

    const openingCash = input.openingCash ?? Number(existing.openingCash);
    const actualCash  = input.actualCash  ?? Number(existing.actualCash);
    const cashSales   = Number(existing.cashSales);
    const expectedCash = openingCash + cashSales;
    const variance     = actualCash - expectedCash;

    const updated = await this.repo.update(id, {
      openingCash, actualCash, expectedCash, variance,
      notes: input.notes,
    });
    return normalise(updated);
  }

  async close(id: string, pharmacyId: string, input: CloseCashClosureInput) {
    const existing = await this.repo.findById(id, pharmacyId);
    if (!existing) throw new AppError("Cash closure not found", 404);
    if (existing.status === "CLOSED") throw new AppError("Already closed", 409);

    const openingCash  = Number(existing.openingCash);
    const cashSales    = Number(existing.cashSales);
    const expectedCash = openingCash + cashSales;
    const variance     = input.actualCash - expectedCash;

    const updated = await this.repo.update(id, {
      actualCash:  input.actualCash,
      expectedCash,
      variance,
      notes:       input.notes ?? existing.notes ?? undefined,
      status:      "CLOSED",
      closedAt:    new Date(),
    });
    return normalise(updated);
  }

  async dispute(id: string, pharmacyId: string) {
    const existing = await this.repo.findById(id, pharmacyId);
    if (!existing) throw new AppError("Cash closure not found", 404);
    if (existing.status !== "CLOSED") throw new AppError("Can only dispute a closed closure", 409);
    const updated = await this.repo.update(id, { status: "DISPUTED" });
    return normalise(updated);
  }
}

function normalise(c: Record<string, unknown>) {
  return {
    ...c,
    openingCash:  Number((c as any).openingCash),
    cashSales:    Number((c as any).cashSales),
    upiSales:     Number((c as any).upiSales),
    cardSales:    Number((c as any).cardSales),
    creditSales:  Number((c as any).creditSales),
    walletSales:  Number((c as any).walletSales),
    expectedCash: Number((c as any).expectedCash),
    actualCash:   Number((c as any).actualCash),
    variance:     Number((c as any).variance),
  };
}
