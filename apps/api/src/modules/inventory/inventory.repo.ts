import type { PrismaClient, Prisma } from "@pharmacy/database";

export class InventoryRepo {
  constructor(private db: PrismaClient) {}

  async upsertBatch(tenantId: string, data: {
    medicineId: string;
    batchNumber: string;
    expiryDate: Date;
    quantity: number;
    purchaseRate: number;
    mrp: number;
    location?: string;
    minimumStock: number;
  }) {
    return this.db.inventory.upsert({
      where: {
        tenantId_medicineId_batchNumber: {
          tenantId,
          medicineId: data.medicineId,
          batchNumber: data.batchNumber,
        },
      },
      update: {
        quantity: { increment: data.quantity },
        purchaseRate: data.purchaseRate,
        mrp: data.mrp,
        location: data.location,
      },
      create: { tenantId, ...data },
      include: { medicine: true },
    });
  }

  async list(tenantId: string, params: { page: number; limit: number; search?: string; medicineId?: string; inStock?: boolean; lowStock?: boolean; nearExpiry?: boolean }) {
    const where: Prisma.InventoryWhereInput = {
      tenantId,
      ...(params.inStock ? { quantity: { gt: 0 } } : {}),
      ...(params.lowStock ? { quantity: { lte: 10 } } : {}),
      ...(params.nearExpiry
        ? { expiryDate: { lte: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) } }
        : {}),
      ...(params.medicineId ? { medicineId: params.medicineId } : {}),
      ...(params.search
        ? { medicine: { name: { contains: params.search, mode: "insensitive" } } }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.inventory.findMany({
        where,
        orderBy: { expiryDate: "asc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: { medicine: { select: { name: true, genericName: true, form: true, hsnCode: true, gstRate: true } } },
      }),
      this.db.inventory.count({ where }),
    ]);

    return { items, total };
  }

  async getById(id: string, tenantId: string) {
    return this.db.inventory.findFirst({
      where: { id, tenantId },
      include: { medicine: true },
    });
  }

  async getExpiryAlerts(tenantId: string, days = 90) {
    const threshold = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return this.db.inventory.findMany({
      where: { tenantId, expiryDate: { lte: threshold }, quantity: { gt: 0 } },
      include: { medicine: { select: { name: true } } },
      orderBy: { expiryDate: "asc" },
    });
  }

  async getLowStockAlerts(tenantId: string) {
    return this.db.inventory.findMany({
      where: {
        tenantId,
        quantity: { gt: 0 },
      },
      include: { medicine: { select: { name: true } } },
    }).then(items => items.filter(i => i.quantity <= i.minimumStock));
  }
}
