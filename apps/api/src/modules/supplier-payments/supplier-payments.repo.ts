import type { Db, DbTransactionClient, Prisma } from "@pharmacy/database";
import { withTenant } from "@pharmacy/database";
import { AppError } from "../../lib/AppError.js";
import { nextSequenceValue } from "../../lib/sequences.js";

// Payments are stored in the shared supplier_ledger_entries table (type =
// PAYMENT, alongside CREDIT_NOTE rows for supplier-credit-notes) — merged to
// cut the Purchases module's table count without changing this module's API
// contract. Every query below filters by type; every response is reshaped
// back to the original `paymentNumber` field name so callers see the exact
// same shape as before the merge.
function toPayment<T extends { entryNumber: string }>(row: T) {
  const { entryNumber, ...rest } = row;
  return { ...rest, paymentNumber: entryNumber };
}

export class SupplierPaymentsRepo {
  constructor(private db: Db) {}

  // "ALL" period = counter never resets (matches the old count()-based
  // numbering, which also never reset by year — only the cosmetic year
  // label in the formatted number changed). Atomic upsert instead of a
  // full-table COUNT(*), and race-safe under concurrent creates.
  private async nextPaymentNumber(pharmacyId: string, tx: DbTransactionClient): Promise<string> {
    const seq  = await nextSequenceValue(tx, pharmacyId, "SUPPLIER_PAYMENT", "ALL");
    const year = new Date().getFullYear();
    return `SP-${year}-${String(seq).padStart(5, "0")}`;
  }

  async create(pharmacyId: string, userId: string, data: {
    supplierId:  string;
    grnId?:      string;
    amount:      number;
    paymentMode: string;
    reference?:  string;
    notes?:      string;
    paidAt?:     Date;
  }) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      // Validate supplier belongs to pharmacy
      const supplier = await tx.supplier.findFirst({
        where:  { id: data.supplierId, pharmacyId },
        select: { id: true, creditLimit: true },
      });
      if (!supplier) throw AppError.notFound("Supplier not found");

      // Validate GRN belongs to pharmacy if provided
      if (data.grnId) {
        const grn = await tx.goodsReceiptNote.findFirst({
          where:  { id: data.grnId, pharmacyId, supplierId: data.supplierId },
          select: { id: true },
        });
        if (!grn) throw AppError.notFound("GRN not found for this supplier");
      }

      const paymentNumber = await this.nextPaymentNumber(pharmacyId, tx);

      const payment = await tx.supplierLedgerEntry.create({
        data: {
          pharmacyId,
          supplierId:  data.supplierId,
          type:        "PAYMENT",
          grnId:       data.grnId,
          entryNumber: paymentNumber,
          amount:      data.amount,
          paymentMode: data.paymentMode as any,
          reference:   data.reference,
          notes:       data.notes,
          paidAt:      data.paidAt ?? new Date(),
          createdBy:   userId,
        },
        include: {
          supplier: { select: { id: true, name: true } },
          grn:      { select: { id: true, grnNumber: true, totalAmount: true } },
        },
      });

      // Ledger-balance decrement and audit log are independent writes —
      // neither depends on the other's result, so run them together.
      await Promise.all([
        tx.supplier.update({
          where: { id: data.supplierId, pharmacyId },
          data:  { ledgerBalance: { decrement: data.amount } },
        }),
        tx.auditLog.create({
          data: {
            pharmacyId, userId,
            action:   "CREATE",
            entity:   "SupplierPayment",
            entityId: payment.id,
            newData:  payment as unknown as Prisma.InputJsonValue,
          },
        }),
      ]);

      return toPayment(payment);
    });
  }

  async getById(id: string, pharmacyId: string) {
    const payment = await this.db.supplierLedgerEntry.findFirst({
      where:   { id, pharmacyId, type: "PAYMENT" },
      include: {
        supplier: { select: { id: true, name: true } },
        grn:      { select: { id: true, grnNumber: true, totalAmount: true, supplierInvoiceNo: true } },
      },
    });
    return payment ? toPayment(payment) : null;
  }

  async list(pharmacyId: string, params: {
    page:        number;
    limit:       number;
    supplierId?: string;
    grnId?:      string;
    from?:       Date;
    to?:         Date;
  }) {
    const where: Prisma.SupplierLedgerEntryWhereInput = {
      pharmacyId,
      type: "PAYMENT",
      ...(params.supplierId ? { supplierId: params.supplierId } : {}),
      ...(params.grnId      ? { grnId: params.grnId }           : {}),
      ...(params.from || params.to
        ? { paidAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
        : {}),
    };

    const [rawItems, total] = await Promise.all([
      this.db.supplierLedgerEntry.findMany({
        where,
        orderBy: { paidAt: "desc" },
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
        include: {
          supplier: { select: { id: true, name: true } },
          grn:      { select: { id: true, grnNumber: true } },
        },
      }),
      this.db.supplierLedgerEntry.count({ where }),
    ]);

    return { items: rawItems.map(toPayment), total, page: params.page, limit: params.limit };
  }

  // Payables across ALL suppliers — same formula as getSupplierBalance
  // (confirmed GRN total − payments), computed in bulk via groupBy so the
  // dues screen stays one round-trip regardless of supplier count.
  async listOutstanding(pharmacyId: string) {
    const now = new Date();
    const [suppliers, purchased, paid, overdue] = await Promise.all([
      this.db.supplier.findMany({
        where:  { pharmacyId },
        select: { id: true, name: true, phone: true, creditDays: true },
      }),
      this.db.goodsReceiptNote.groupBy({
        by: ["supplierId"],
        where: { pharmacyId, status: "CONFIRMED" },
        _sum: { totalAmount: true },
      }),
      this.db.supplierLedgerEntry.groupBy({
        by: ["supplierId"],
        where: { pharmacyId, type: "PAYMENT" },
        _sum: { amount: true },
      }),
      this.db.goodsReceiptNote.groupBy({
        by: ["supplierId"],
        where: { pharmacyId, status: "CONFIRMED", paymentDueDate: { lt: now } },
        _sum: { totalAmount: true },
      }),
    ]);

    const purchasedMap = new Map(purchased.map((r) => [r.supplierId, Number(r._sum.totalAmount ?? 0)]));
    const paidMap      = new Map(paid.map((r) => [r.supplierId, Number(r._sum.amount ?? 0)]));
    const overdueMap   = new Map(overdue.map((r) => [r.supplierId, Number(r._sum.totalAmount ?? 0)]));

    const list = suppliers
      .map((s) => {
        const totalPurchased = purchasedMap.get(s.id) ?? 0;
        const totalPaid      = paidMap.get(s.id) ?? 0;
        return {
          id:            s.id,
          name:          s.name,
          phone:         s.phone,
          creditDays:    s.creditDays,
          totalPurchased,
          totalPaid,
          outstanding:   totalPurchased - totalPaid,
          overdueAmount: overdueMap.get(s.id) ?? 0,
        };
      })
      .filter((s) => s.outstanding > 0.01)
      .sort((a, b) => b.outstanding - a.outstanding);

    return {
      suppliers:        list,
      totalOutstanding: list.reduce((sum, s) => sum + s.outstanding, 0),
      totalOverdue:     list.reduce((sum, s) => sum + s.overdueAmount, 0),
      count:            list.length,
    };
  }

  // Outstanding balance = total confirmed GRN amounts - total payments per supplier (#15 + #16)
  async getSupplierBalance(supplierId: string, pharmacyId: string) {
    const supplier = await this.db.supplier.findFirst({
      where:  { id: supplierId, pharmacyId },
      select: { id: true, name: true, creditLimit: true, creditDays: true },
    });
    if (!supplier) throw AppError.notFound("Supplier not found");

    const [grnTotal, paymentTotal, overdueGRNs] = await Promise.all([
      this.db.goodsReceiptNote.aggregate({
        where: { pharmacyId, supplierId, status: "CONFIRMED" },
        _sum:  { totalAmount: true },
      }),
      this.db.supplierLedgerEntry.aggregate({
        where: { pharmacyId, supplierId, type: "PAYMENT" },
        _sum:  { amount: true },
      }),
      this.db.goodsReceiptNote.findMany({
        where:   { pharmacyId, supplierId, status: "CONFIRMED", paymentDueDate: { lt: new Date() } },
        select:  { id: true, grnNumber: true, totalAmount: true, paymentDueDate: true, supplierInvoiceNo: true },
        orderBy: { paymentDueDate: "asc" },
      }),
    ]);

    const totalPurchased = Number(grnTotal._sum.totalAmount ?? 0);
    const totalPaid      = Number(paymentTotal._sum.amount ?? 0);
    const outstanding    = totalPurchased - totalPaid;
    const overdueAmount  = overdueGRNs.reduce((sum, g) => sum + g.totalAmount, 0);

    return {
      supplier,
      totalPurchased,
      totalPaid,
      outstanding,
      overdueAmount,
      overdueGRNs,
      creditLimit:  supplier.creditLimit,
      creditDays:   supplier.creditDays,
    };
  }
}
