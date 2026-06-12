import type { Db, Prisma } from "@pharmacy/database";
import { AppError } from "../../lib/AppError.js";

export class SupplierPaymentsRepo {
  constructor(private db: Db) {}

  private async nextPaymentNumber(pharmacyId: string, tx: Omit<Db, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">): Promise<string> {
    const count = await tx.supplierPayment.count({ where: { pharmacyId } });
    const year  = new Date().getFullYear();
    return `SP-${year}-${String(count + 1).padStart(5, "0")}`;
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
    return this.db.$transaction(async (tx) => {
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

      const payment = await tx.supplierPayment.create({
        data: {
          pharmacyId,
          supplierId:    data.supplierId,
          grnId:         data.grnId,
          paymentNumber,
          amount:        data.amount,
          paymentMode:   data.paymentMode as any,
          reference:     data.reference,
          notes:         data.notes,
          paidAt:        data.paidAt ?? new Date(),
          createdBy:     userId,
        },
        include: {
          supplier: { select: { id: true, name: true } },
          grn:      { select: { id: true, grnNumber: true, totalAmount: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          pharmacyId, userId,
          action:   "CREATE",
          entity:   "SupplierPayment",
          entityId: payment.id,
          newData:  payment as unknown as Prisma.InputJsonValue,
        },
      });

      return payment;
    });
  }

  async getById(id: string, pharmacyId: string) {
    return this.db.supplierPayment.findFirst({
      where:   { id, pharmacyId },
      include: {
        supplier: { select: { id: true, name: true } },
        grn:      { select: { id: true, grnNumber: true, totalAmount: true, supplierInvoiceNo: true } },
      },
    });
  }

  async list(pharmacyId: string, params: {
    page:        number;
    limit:       number;
    supplierId?: string;
    grnId?:      string;
    from?:       Date;
    to?:         Date;
  }) {
    const where: Prisma.SupplierPaymentWhereInput = {
      pharmacyId,
      ...(params.supplierId ? { supplierId: params.supplierId } : {}),
      ...(params.grnId      ? { grnId: params.grnId }           : {}),
      ...(params.from || params.to
        ? { paidAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.supplierPayment.findMany({
        where,
        orderBy: { paidAt: "desc" },
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
        include: {
          supplier: { select: { id: true, name: true } },
          grn:      { select: { id: true, grnNumber: true } },
        },
      }),
      this.db.supplierPayment.count({ where }),
    ]);

    return { items, total, page: params.page, limit: params.limit };
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
      this.db.supplierPayment.aggregate({
        where: { pharmacyId, supplierId },
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
