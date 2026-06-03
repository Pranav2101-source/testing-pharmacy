import type { PrismaClient, PurchaseStatus } from "@pharmacy/database";
import type { CreateSupplierInput, UpdateSupplierInput } from "./suppliers.schema.js";

export class SuppliersRepo {
  constructor(private db: PrismaClient) {}

  async create(pharmacyId: string, data: CreateSupplierInput) {
    return this.db.supplier.create({ data: { pharmacyId, ...data } });
  }

  async update(id: string, pharmacyId: string, data: UpdateSupplierInput) {
    return this.db.supplier.update({ where: { id }, data });
  }

  async getById(id: string, pharmacyId: string) {
    return this.db.supplier.findFirst({
      where:   { id, pharmacyId },
      include: {
        _count: { select: { purchaseOrders: true, grns: true } },
      },
    });
  }

  async list(pharmacyId: string, page = 1, limit = 20, search?: string) {
    const where = {
      pharmacyId,
      isActive: true,
      ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
    };

    const [items, total] = await Promise.all([
      this.db.supplier.findMany({
        where,
        orderBy: { name: "asc" },
        skip:    (page - 1) * limit,
        take:    limit,
        include: { _count: { select: { purchaseOrders: true } } },
      }),
      this.db.supplier.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async listAll(pharmacyId: string) {
    return this.db.supplier.findMany({
      where:   { pharmacyId, isActive: true },
      orderBy: { name: "asc" },
      select:  { id: true, name: true, phone: true },
    });
  }

  async getPurchaseHistory(id: string, pharmacyId: string, page = 1, limit = 20) {
    const where = { pharmacyId, supplierId: id };
    const [orders, grns, totals] = await Promise.all([
      this.db.purchaseOrder.findMany({
        where,
        orderBy: { orderedAt: "desc" },
        skip:    (page - 1) * limit,
        take:    limit,
        include: { _count: { select: { items: true } } },
      }),
      this.db.goodsReceiptNote.findMany({
        where:   { pharmacyId, supplierId: id },
        orderBy: { createdAt: "desc" },
        take:    5,
        select:  { id: true, grnNumber: true, status: true, totalAmount: true, createdAt: true },
      }),
      this.db.purchaseOrder.aggregate({
        where:  { ...where, status: { in: ["RECEIVED", "PARTIAL"] } },
        _sum:   { totalAmount: true },
        _count: { id: true },
      }),
    ]);

    return {
      orders: { items: orders, page, limit },
      recentGRNs: grns,
      summary: {
        totalOrders:   totals._count.id,
        totalSpend:    totals._sum.totalAmount ?? 0,
      },
    };
  }

  // Backward-compat: kept for old route that creates PO+stock in one shot
  async listPurchaseOrders(pharmacyId: string, page = 1, limit = 20, status?: string) {
    const where = { pharmacyId, ...(status ? { status: status as PurchaseStatus } : {}) };
    const [items, total] = await Promise.all([
      this.db.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip:    (page - 1) * limit,
        take:    limit,
        include: {
          supplier: { select: { name: true } },
          items:    { select: { quantity: true, amount: true } },
        },
      }),
      this.db.purchaseOrder.count({ where }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async createPurchaseOrder(pharmacyId: string, data: {
    supplierId:  string;
    orderNumber: string;
    invoiceNo?:  string;
    notes?:      string;
    subtotal:    number;
    totalGst:    number;
    totalAmount: number;
    items: Array<{
      medicineName: string;
      batchNumber:  string;
      expiryDate:   Date;
      quantity:     number;
      purchaseRate: number;
      mrp:          number;
      gstRate:      number;
      cgst:         number;
      sgst:         number;
      amount:       number;
    }>;
  }) {
    return this.db.purchaseOrder.create({
      data: {
        pharmacyId,
        supplierId:   data.supplierId,
        orderNumber:  data.orderNumber,
        invoiceNo:    data.invoiceNo,
        notes:        data.notes,
        status:       "RECEIVED",
        subtotal:     data.subtotal,
        totalGst:     data.totalGst,
        totalAmount:  data.totalAmount,
        receivedAt:   new Date(),
        items:        { create: data.items },
      },
      include: { items: true, supplier: true },
    });
  }
}
