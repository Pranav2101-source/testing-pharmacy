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
        include: { medicine: { select: { name: true, genericName: true, form: true, hsnCode: true, gstRate: true, isActive: true } } },
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

  // Atomic stock adjustment — negative delta is allowed but cannot bring quantity below 0
  async adjustStock(params: {
    id:       string;
    tenantId: string;
    userId:   string;
    delta:    number;
    reason:   string;
    type:     string;
  }) {
    return this.db.$transaction(async (tx) => {
      const item = await tx.inventory.findFirst({
        where:  { id: params.id, tenantId: params.tenantId },
        select: { quantity: true },
      });

      if (!item) {
        throw Object.assign(new Error("Inventory item not found"), { statusCode: 404 });
      }

      const newQty = item.quantity + params.delta;
      if (newQty < 0) {
        throw Object.assign(
          new Error(
            `Cannot reduce stock below zero. Current: ${item.quantity}, requested delta: ${params.delta}`
          ),
          { statusCode: 422 }
        );
      }

      const updated = await tx.inventory.update({
        where:   { id: params.id },
        data:    { quantity: newQty },
        include: { medicine: { select: { name: true } } },
      });

      await tx.inventoryMovement.create({
        data: {
          tenantId:       params.tenantId,
          userId:         params.userId,
          inventoryId:    params.id,
          type:           "ADJUSTMENT",
          direction:      params.delta > 0 ? "IN" : "OUT",
          quantity:       Math.abs(params.delta),
          quantityBefore: item.quantity,
          quantityAfter:  newQty,
          referenceType:  params.type,
          notes:          params.reason,
        },
      });

      return updated;
    });
  }

  // ── Stock reservation ────────────────────────────────────────────────────
  //
  // Called when the billing cart changes. Replaces any previous reservation
  // for the same sessionId with the current cart state. Also runs lazy cleanup
  // of expired reservations. Returns available quantities after reservation.
  // Throws 409 if any item has insufficient unreserved stock.

  async upsertReservations(params: {
    tenantId:  string;
    sessionId: string;
    items:     { inventoryId: string; quantity: number }[];
  }): Promise<{ inventoryId: string; available: number }[]> {
    return this.db.$transaction(async (tx) => {

      // Step 0 — lazy cleanup: purge expired reservations and fix reservedQuantity
      const expired = await tx.stockReservation.findMany({
        where:  { expiresAt: { lt: new Date() } },
        select: { inventoryId: true, quantity: true },
      });
      if (expired.length > 0) {
        await tx.stockReservation.deleteMany({ where: { expiresAt: { lt: new Date() } } });
        const grouped = new Map<string, number>();
        for (const r of expired) {
          grouped.set(r.inventoryId, (grouped.get(r.inventoryId) ?? 0) + r.quantity);
        }
        for (const [inventoryId, qty] of grouped) {
          await tx.inventory.update({
            where: { id: inventoryId },
            data:  { reservedQuantity: { decrement: qty } },
          });
        }
      }

      // Step 1 — read existing reservations for this session
      const existing = await tx.stockReservation.findMany({
        where:  { tenantId: params.tenantId, sessionId: params.sessionId },
        select: { inventoryId: true, quantity: true },
      });
      const existingMap = new Map<string, number>(
        existing.map((r: { inventoryId: string; quantity: number }): [string, number] => [r.inventoryId, r.quantity])
      );

      // Step 2 — validate availability (reserved by *other* sessions must not exceed free stock)
      type Conflict = { inventoryId: string; available: number; requested: number };
      const conflicts: Conflict[] = [];
      const results: { inventoryId: string; available: number }[] = [];

      for (const item of params.items) {
        const inv = await tx.inventory.findFirst({
          where:  { id: item.inventoryId, tenantId: params.tenantId },
          select: { quantity: true, reservedQuantity: true },
        });
        if (!inv) continue;

        const thisSessionQty  = existingMap.get(item.inventoryId) ?? 0;
        const reservedByOthers = Math.max(0, inv.reservedQuantity - thisSessionQty);
        const available        = inv.quantity - reservedByOthers;
        results.push({ inventoryId: item.inventoryId, available });

        if (item.quantity > available) {
          conflicts.push({ inventoryId: item.inventoryId, available, requested: item.quantity });
        }
      }

      if (conflicts.length > 0) {
        const err = Object.assign(new Error("Insufficient unreserved stock"), {
          statusCode: 409,
          conflicts,
        });
        throw err;
      }

      // Step 3 — remove old reservations for this session
      if (existing.length > 0) {
        await tx.stockReservation.deleteMany({
          where: { tenantId: params.tenantId, sessionId: params.sessionId },
        });
        for (const [inventoryId, qty] of existingMap) {
          await tx.inventory.update({
            where: { id: inventoryId },
            data:  { reservedQuantity: { decrement: qty } },
          });
        }
      }

      // Step 4 — create new reservations
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30-min TTL
      await tx.stockReservation.createMany({
        data: params.items.map((item) => ({
          tenantId:    params.tenantId,
          inventoryId: item.inventoryId,
          sessionId:   params.sessionId,
          quantity:    item.quantity,
          expiresAt,
        })),
      });
      for (const item of params.items) {
        await tx.inventory.update({
          where: { id: item.inventoryId },
          data:  { reservedQuantity: { increment: item.quantity } },
        });
      }

      return results;
    });
  }

  // Called on cart clear, bill saved, component unmount.
  async releaseReservations(params: { tenantId: string; sessionId: string }): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const existing = await tx.stockReservation.findMany({
        where:  { tenantId: params.tenantId, sessionId: params.sessionId },
        select: { inventoryId: true, quantity: true },
      });
      if (existing.length === 0) return;

      await tx.stockReservation.deleteMany({
        where: { tenantId: params.tenantId, sessionId: params.sessionId },
      });
      for (const res of existing) {
        await tx.inventory.update({
          where: { id: res.inventoryId },
          data:  { reservedQuantity: { decrement: res.quantity } },
        });
      }
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
