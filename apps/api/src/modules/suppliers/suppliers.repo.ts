import type { PrismaClient } from "@pharmacy/database";
import type { CreateSupplierInput } from "./suppliers.schema.js";

export class SuppliersRepo {
  constructor(private db: PrismaClient) {}

  async create(tenantId: string, data: CreateSupplierInput) {
    return this.db.supplier.create({ data: { tenantId, ...data } });
  }

  async list(tenantId: string, page = 1, limit = 20) {
    const [items, total] = await Promise.all([
      this.db.supplier.findMany({
        where: { tenantId, isActive: true },
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.supplier.count({ where: { tenantId, isActive: true } }),
    ]);
    return { items, total };
  }

  async getById(id: string, tenantId: string) {
    return this.db.supplier.findFirst({ where: { id, tenantId } });
  }

  async createPurchaseOrder(tenantId: string, data: {
    supplierId: string;
    orderNumber: string;
    invoiceNo?: string;
    notes?: string;
    subtotal: number;
    totalGst: number;
    totalAmount: number;
    items: Array<{
      medicineName: string;
      batchNumber: string;
      expiryDate: Date;
      quantity: number;
      purchaseRate: number;
      mrp: number;
      gstRate: number;
      cgst: number;
      sgst: number;
      amount: number;
    }>;
  }) {
    return this.db.purchaseOrder.create({
      data: {
        tenantId,
        supplierId: data.supplierId,
        orderNumber: data.orderNumber,
        invoiceNo: data.invoiceNo,
        notes: data.notes,
        status: "RECEIVED",
        subtotal: data.subtotal,
        totalGst: data.totalGst,
        totalAmount: data.totalAmount,
        receivedAt: new Date(),
        items: { create: data.items },
      },
      include: { items: true, supplier: true },
    });
  }
}
