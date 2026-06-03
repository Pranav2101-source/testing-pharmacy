import type { PrismaClient, Prisma } from "@pharmacy/database";
import { AppError } from "../../lib/AppError.js";

const RESERVATION_TTL_MS =
  Number(process.env["RESERVATION_TTL_MINUTES"] ?? 30) * 60 * 1000;

const MEDICINE_SELECT = {
  id:          true,
  name:        true,
  genericName: true,
  form:        true,
  strength:    true,
  hsnCode:     true,
  gstRate:     true,
  isActive:    true,
  brand:       { select: { id: true, name: true } },
} as const;

const SHELF_SELECT = {
  id:   true,
  code: true,
  rack: { select: { id: true, code: true, name: true } },
} as const;

const INVENTORY_INCLUDE = {
  medicine: { select: MEDICINE_SELECT },
  shelf:    { select: SHELF_SELECT },
} as const;

export class InventoryRepo {
  constructor(readonly db: PrismaClient) {}

  async upsertBatch(pharmacyId: string, data: {
    medicineId:   string;
    batchNumber:  string;
    expiryDate:   Date;
    quantity:     number;
    purchaseRate: number;
    mrp:          number;
    location?:    string;
    shelfId?:     string;
    minimumStock: number;
    reorderLevel?: number;
  }) {
    return this.db.inventory.upsert({
      where: {
        pharmacyId_medicineId_batchNumber: { pharmacyId, medicineId: data.medicineId, batchNumber: data.batchNumber },
      },
      update: {
        quantity:     { increment: data.quantity },
        purchaseRate: data.purchaseRate,
        mrp:          data.mrp,
        location:     data.location,
        ...(data.shelfId !== undefined ? { shelfId: data.shelfId } : {}),
        status:       "ACTIVE",
      },
      create: { pharmacyId, ...data, reorderLevel: data.reorderLevel ?? 5, status: "ACTIVE" },
      include: INVENTORY_INCLUDE,
    });
  }

  async list(pharmacyId: string, params: {
    page:        number;
    limit:       number;
    search?:     string;
    medicineId?: string;
    inStock?:    boolean;
    lowStock?:   boolean;
    nearExpiry?: boolean;
    status?:     string;
  }) {
    const where: Prisma.InventoryWhereInput = {
      pharmacyId,
      ...(params.inStock    ? { quantity: { gt: 0 } } : {}),
      ...(params.nearExpiry ? { expiryDate: { lte: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) } } : {}),
      ...(params.medicineId ? { medicineId: params.medicineId } : {}),
      ...(params.status     ? { status: params.status as any } : {}),
      ...(params.search
        ? {
            OR: [
              { medicine: { name: { contains: params.search, mode: "insensitive" } } },
              { medicine: { genericName: { contains: params.search, mode: "insensitive" } } },
              { batchNumber: { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [allItems, total] = await Promise.all([
      this.db.inventory.findMany({
        where,
        orderBy: [{ expiryDate: "asc" }, { createdAt: "desc" }],
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
        include: INVENTORY_INCLUDE,
      }),
      this.db.inventory.count({ where }),
    ]);

    const items = params.lowStock
      ? allItems.filter((i) => i.quantity > 0 && i.quantity <= i.minimumStock)
      : allItems;

    return { items, total, page: params.page, limit: params.limit };
  }

  async getById(id: string, pharmacyId: string) {
    return this.db.inventory.findFirst({
      where:   { id, pharmacyId },
      include: INVENTORY_INCLUDE,
    });
  }

  async updateBatchStatus(id: string, pharmacyId: string, userId: string, status: string, reason: string) {
    return this.db.$transaction(async (tx) => {
      const item = await tx.inventory.findFirst({
        where:  { id, pharmacyId },
        select: { quantity: true, status: true },
      });
      if (!item) throw AppError.notFound("Inventory item not found");

      const updated = await tx.inventory.update({
        where:   { id },
        data:    { status: status as any },
        include: INVENTORY_INCLUDE,
      });

      await tx.inventoryMovement.create({
        data: {
          pharmacyId,
          userId,
          inventoryId:   id,
          type:          status === "DAMAGED" ? "DAMAGE" : "ADJUSTMENT",
          direction:     "OUT",
          quantity:      0,
          quantityBefore: item.quantity,
          quantityAfter:  item.quantity,
          referenceType:  `STATUS_CHANGE:${item.status}->${status}`,
          notes:          reason,
        },
      });

      return updated;
    });
  }

  async adjustStock(params: {
    id:         string;
    pharmacyId: string;
    userId:     string;
    delta:      number;
    reason:     string;
    type:       string;
  }) {
    return this.db.$transaction(async (tx) => {
      const item = await tx.inventory.findFirst({
        where:  { id: params.id, pharmacyId: params.pharmacyId },
        select: { quantity: true },
      });
      if (!item) throw AppError.notFound("Inventory item not found");

      const newQty = item.quantity + params.delta;
      if (newQty < 0) {
        throw AppError.unprocessable(
          `Cannot reduce stock below zero. Current: ${item.quantity}, delta: ${params.delta}`,
        );
      }

      const updated = await tx.inventory.update({
        where:   { id: params.id },
        data:    { quantity: newQty },
        include: INVENTORY_INCLUDE,
      });

      await tx.inventoryMovement.create({
        data: {
          pharmacyId:     params.pharmacyId,
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

  // ── Stock Ledger ───────────────────────────────────────────────────────────

  async getLedger(pharmacyId: string, params: {
    page:         number;
    limit:        number;
    inventoryId?: string;
    medicineId?:  string;
    type?:        string;
    direction?:   string;
    from?:        Date;
    to?:          Date;
  }) {
    const where: Prisma.InventoryMovementWhereInput = {
      pharmacyId,
      ...(params.inventoryId ? { inventoryId: params.inventoryId } : {}),
      ...(params.type        ? { type: params.type as any } : {}),
      ...(params.direction   ? { direction: params.direction as any } : {}),
      ...(params.from || params.to
        ? { createdAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
        : {}),
      ...(params.medicineId
        ? { inventory: { medicineId: params.medicineId } }
        : {}),
    };

    const [movements, total] = await Promise.all([
      this.db.inventoryMovement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
        include: {
          inventory: {
            select: {
              batchNumber: true,
              medicine:    { select: { name: true, genericName: true } },
            },
          },
          user: { select: { id: true, name: true } },
        },
      }),
      this.db.inventoryMovement.count({ where }),
    ]);

    return { movements, total, page: params.page, limit: params.limit };
  }

  // ── Stock Reservation ─────────────────────────────────────────────────────

  async upsertReservations(params: {
    pharmacyId: string;
    sessionId:  string;
    items:      { inventoryId: string; quantity: number }[];
  }): Promise<{ inventoryId: string; available: number }[]> {
    return this.db.$transaction(async (tx) => {
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
          await tx.inventory.update({ where: { id: inventoryId }, data: { reservedQuantity: { decrement: qty } } });
        }
      }

      const existing = await tx.stockReservation.findMany({
        where:  { pharmacyId: params.pharmacyId, sessionId: params.sessionId },
        select: { inventoryId: true, quantity: true },
      });
      const existingMap = new Map<string, number>(existing.map((r): [string, number] => [r.inventoryId, r.quantity]));

      type Conflict = { inventoryId: string; available: number; requested: number };
      const conflicts: Conflict[] = [];
      const results: { inventoryId: string; available: number }[] = [];

      for (const item of params.items) {
        const inv = await tx.inventory.findFirst({
          where:  { id: item.inventoryId, pharmacyId: params.pharmacyId, status: "ACTIVE" },
          select: { quantity: true, reservedQuantity: true },
        });
        if (!inv) continue;

        const thisSessionQty   = existingMap.get(item.inventoryId) ?? 0;
        const reservedByOthers = Math.max(0, inv.reservedQuantity - thisSessionQty);
        const available        = inv.quantity - reservedByOthers;
        results.push({ inventoryId: item.inventoryId, available });

        if (item.quantity > available) {
          conflicts.push({ inventoryId: item.inventoryId, available, requested: item.quantity });
        }
      }

      if (conflicts.length > 0) {
        throw Object.assign(new Error("Insufficient unreserved stock"), { statusCode: 409, conflicts });
      }

      if (existing.length > 0) {
        await tx.stockReservation.deleteMany({ where: { pharmacyId: params.pharmacyId, sessionId: params.sessionId } });
        for (const [inventoryId, qty] of existingMap) {
          await tx.inventory.update({ where: { id: inventoryId }, data: { reservedQuantity: { decrement: qty } } });
        }
      }

      const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);
      await tx.stockReservation.createMany({
        data: params.items.map((item) => ({
          pharmacyId: params.pharmacyId, inventoryId: item.inventoryId,
          sessionId:  params.sessionId,  quantity:    item.quantity, expiresAt,
        })),
      });
      for (const item of params.items) {
        await tx.inventory.update({ where: { id: item.inventoryId }, data: { reservedQuantity: { increment: item.quantity } } });
      }

      return results;
    });
  }

  async releaseReservations(params: { pharmacyId: string; sessionId: string }): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const existing = await tx.stockReservation.findMany({
        where:  { pharmacyId: params.pharmacyId, sessionId: params.sessionId },
        select: { inventoryId: true, quantity: true },
      });
      if (existing.length === 0) return;

      await tx.stockReservation.deleteMany({ where: { pharmacyId: params.pharmacyId, sessionId: params.sessionId } });
      for (const res of existing) {
        await tx.inventory.update({ where: { id: res.inventoryId }, data: { reservedQuantity: { decrement: res.quantity } } });
      }
    });
  }

  // ── Alerts ────────────────────────────────────────────────────────────────

  async getExpiryAlerts(pharmacyId: string) {
    const now      = new Date();
    const d30      = new Date(Date.now() +  30 * 86400_000);
    const d60      = new Date(Date.now() +  60 * 86400_000);
    const d90      = new Date(Date.now() +  90 * 86400_000);

    const items = await this.db.inventory.findMany({
      where:   { pharmacyId, expiryDate: { lte: d90 }, quantity: { gt: 0 } },
      include: { medicine: { select: { name: true, genericName: true, form: true } } },
      orderBy: { expiryDate: "asc" },
    });

    return items.map((i) => ({
      ...i,
      tier: i.expiryDate <= now ? "EXPIRED"  as const
          : i.expiryDate <= d30 ? "CRITICAL" as const
          : i.expiryDate <= d60 ? "WARNING"  as const
                                : "NOTICE"   as const,
      daysToExpiry: Math.ceil((i.expiryDate.getTime() - now.getTime()) / 86400_000),
    }));
  }

  async getLowStockAlerts(pharmacyId: string) {
    const items = await this.db.inventory.findMany({
      where:   { pharmacyId, status: "ACTIVE" },
      include: { medicine: { select: { name: true, genericName: true, form: true } } },
    });
    // Split into out-of-stock, reorder needed, and low (between reorder and minimum)
    return items
      .filter((i) => i.quantity <= i.minimumStock)
      .map((i) => ({
        ...i,
        tier: i.quantity === 0          ? "OUT_OF_STOCK" as const
            : i.quantity <= i.reorderLevel ? "REORDER"     as const
                                           : "LOW"         as const,
      }))
      .sort((a, b) => a.quantity - b.quantity);
  }

  // ── FEFO batch selection (used by billing) ─────────────────────────────────

  async getFEFOBatch(medicineId: string, pharmacyId: string, quantity: number) {
    return this.db.inventory.findFirst({
      where: {
        pharmacyId,
        medicineId,
        status:    "ACTIVE",
        quantity:  { gte: quantity },
        expiryDate: { gt: new Date() },
      },
      orderBy: { expiryDate: "asc" },
    });
  }

  // ── Batch Recall ───────────────────────────────────────────────────────────

  async batchRecall(pharmacyId: string, userId: string, data: {
    batchNumber: string;
    medicineId?: string;
    reason:      string;
  }) {
    return this.db.$transaction(async (tx) => {
      const affected = await tx.inventory.findMany({
        where: {
          pharmacyId,
          batchNumber: data.batchNumber,
          status:      "ACTIVE",
          ...(data.medicineId ? { medicineId: data.medicineId } : {}),
        },
        include: { medicine: { select: { id: true, name: true } } },
      });

      if (affected.length === 0)
        throw AppError.notFound("No ACTIVE batches found matching the given batch number")

      for (const item of affected) {
        await tx.inventory.update({
          where: { id: item.id },
          data:  { status: "QUARANTINE" },
        });

        await tx.inventoryMovement.create({
          data: {
            pharmacyId,
            userId,
            inventoryId:    item.id,
            type:           "ADJUSTMENT",
            direction:      "OUT",
            quantity:       0,
            quantityBefore: item.quantity,
            quantityAfter:  item.quantity,
            referenceType:  "BATCH_RECALL",
            notes:          `RECALL: ${data.reason}`,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId,
          action:   "UPDATE",
          entity:   "BatchRecall",
          newData:  {
            batchNumber:   data.batchNumber,
            medicineId:    data.medicineId,
            reason:        data.reason,
            affectedCount: affected.length,
            affectedIds:   affected.map((i) => i.id),
          },
        },
      });

      return { affectedCount: affected.length, items: affected };
    });
  }

  async listRecalledBatches(pharmacyId: string, params: {
    page:         number;
    limit:        number;
    batchNumber?: string;
  }) {
    const where = {
      pharmacyId,
      status: "QUARANTINE" as const,
      inventoryMovements: {
        some: { notes: { startsWith: "RECALL:" } },
      },
      ...(params.batchNumber ? { batchNumber: { contains: params.batchNumber, mode: "insensitive" as const } } : {}),
    };

    const [items, total] = await Promise.all([
      this.db.inventory.findMany({
        where,
        include: {
          ...INVENTORY_INCLUDE,
          inventoryMovements: {
            where:   { notes: { startsWith: "RECALL:" } },
            orderBy: { createdAt: "desc" },
            take:    1,
          },
        },
        orderBy: { updatedAt: "desc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.db.inventory.count({ where }),
    ]);

    return { items, total, page: params.page, limit: params.limit };
  }
}
