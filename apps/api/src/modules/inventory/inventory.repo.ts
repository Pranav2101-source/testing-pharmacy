import { Prisma, type PrismaClient, type BatchStatus, type MovementType, type MovementDirection } from "@pharmacy/database";
import { AppError } from "../../lib/AppError.js";
import { env } from "../../config/env.js";

const RESERVATION_TTL_MS = env.RESERVATION_TTL_MINUTES * 60 * 1000;

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
    // lowStock requires a column-to-column comparison (quantity <= minimumStock)
    // that Prisma's where API cannot express. We use $queryRaw for correct DB-level
    // filtering and pagination, then reload the matching rows with findMany for the
    // full include shape.
    if (params.lowStock) {
      const offset      = (params.page - 1) * params.limit;
      const nearExpDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

      const searchSql    = params.search
        ? Prisma.sql`AND (m.name ILIKE ${`%${params.search}%`} OR m."genericName" ILIKE ${`%${params.search}%`} OR i."batchNumber" ILIKE ${`%${params.search}%`})`
        : Prisma.empty;
      const medicineSql  = params.medicineId
        ? Prisma.sql`AND i."medicineId" = ${params.medicineId}`
        : Prisma.empty;
      const nearExpSql   = params.nearExpiry
        ? Prisma.sql`AND i."expiryDate" <= ${nearExpDate}`
        : Prisma.empty;
      const statusSql    = params.status
        ? Prisma.sql`AND i.status::text = ${params.status}`
        : Prisma.empty;

      const [countRows, idRows] = await Promise.all([
        this.db.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*) AS count
          FROM   inventory i
          JOIN   medicines m ON m.id = i."medicineId"
          WHERE  i."pharmacyId" = ${pharmacyId}
            AND  i.quantity > 0
            AND  i.quantity <= i."minimumStock"
            ${searchSql} ${medicineSql} ${nearExpSql} ${statusSql}
        `,
        this.db.$queryRaw<Array<{ id: string }>>`
          SELECT i.id
          FROM   inventory i
          JOIN   medicines m ON m.id = i."medicineId"
          WHERE  i."pharmacyId" = ${pharmacyId}
            AND  i.quantity > 0
            AND  i.quantity <= i."minimumStock"
            ${searchSql} ${medicineSql} ${nearExpSql} ${statusSql}
          ORDER BY i."expiryDate" ASC, i."createdAt" DESC
          LIMIT  ${params.limit} OFFSET ${offset}
        `,
      ]);

      const ids   = idRows.map((r) => r.id);
      const items = ids.length > 0
        ? await this.db.inventory.findMany({
            where:   { id: { in: ids } },
            orderBy: [{ expiryDate: "asc" }, { createdAt: "desc" }],
            include: INVENTORY_INCLUDE,
          })
        : [];

      return {
        items,
        total: Number(countRows[0]?.count ?? 0),
        page:  params.page,
        limit: params.limit,
      };
    }

    const where: Prisma.InventoryWhereInput = {
      pharmacyId,
      ...(params.inStock    ? { quantity: { gt: 0 } } : {}),
      ...(params.nearExpiry ? { expiryDate: { lte: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) } } : {}),
      ...(params.medicineId ? { medicineId: params.medicineId } : {}),
      ...(params.status     ? { status: params.status as BatchStatus } : {}),
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

    const [items, total] = await Promise.all([
      this.db.inventory.findMany({
        where,
        orderBy: [{ expiryDate: "asc" }, { createdAt: "desc" }],
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
        include: INVENTORY_INCLUDE,
      }),
      this.db.inventory.count({ where }),
    ]);

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

      // updateMany accepts arbitrary WHERE conditions (unlike update, which
      // requires a unique-constraint selector).  Including pharmacyId ensures
      // the write is tenant-scoped even if id were somehow reused across
      // pharmacies — defense-in-depth on top of the findFirst check above.
      await tx.inventory.updateMany({
        where: { id, pharmacyId },
        data:  { status: status as BatchStatus },
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

      // Reload the full object with relations after the updateMany.
      const updated = await tx.inventory.findFirst({ where: { id, pharmacyId }, include: INVENTORY_INCLUDE });
      if (!updated) throw AppError.notFound("Inventory item not found after status update");
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

      // A zero-delta adjustment is a no-op — there is nothing to record and
      // writing a movement with quantity=0 and direction="OUT" (the result of
      // `params.delta > 0 ? "IN" : "OUT"`) would be misleading in the ledger.
      if (params.delta === 0) {
        return tx.inventory.findFirst({ where: { id: params.id, pharmacyId: params.pharmacyId }, include: INVENTORY_INCLUDE });
      }

      const newQty = item.quantity + params.delta;
      if (newQty < 0) {
        throw AppError.unprocessable(
          `Cannot reduce stock below zero. Current: ${item.quantity}, delta: ${params.delta}`,
        );
      }

      await tx.inventory.updateMany({
        where: { id: params.id, pharmacyId: params.pharmacyId },
        data:  { quantity: newQty },
      });
      const updated = await tx.inventory.findFirst({ where: { id: params.id, pharmacyId: params.pharmacyId }, include: INVENTORY_INCLUDE });
      if (!updated) throw AppError.notFound("Inventory item not found after adjustment");

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
      ...(params.type        ? { type: params.type as MovementType } : {}),
      ...(params.direction   ? { direction: params.direction as MovementDirection } : {}),
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
      // Serializable isolation prevents two concurrent sessions from both reading
      // the same available stock, computing "no conflict", and then both writing
      // reservations — which would let total reserved quantity exceed actual stock.
      // The billing transaction at checkout enforces the hard stock floor, but
      // surfacing the conflict here at reservation time gives users an early warning
      // without them discovering the problem only when they hit "Confirm Bill".
      const now = new Date();

      // Expired reservation cleanup — scoped to this pharmacy to avoid cross-tenant writes.
      // Single raw SQL decrement instead of N individual updates.
      const expired = await tx.stockReservation.findMany({
        where:  { pharmacyId: params.pharmacyId, expiresAt: { lt: now } },
        select: { inventoryId: true, quantity: true },
      });
      if (expired.length > 0) {
        const expIds  = expired.map((r) => r.inventoryId);
        const expQtys = expired.map((r) => r.quantity);
        await Promise.all([
          tx.stockReservation.deleteMany({ where: { pharmacyId: params.pharmacyId, expiresAt: { lt: now } } }),
          tx.$executeRaw`
            UPDATE inventory inv
            SET "reservedQuantity" = GREATEST(0, inv."reservedQuantity" - b.qty)
            FROM (SELECT unnest(${expIds}::text[]) AS id, unnest(${expQtys}::int[]) AS qty) AS b
            WHERE inv.id = b.id AND inv."pharmacyId" = ${params.pharmacyId}::text
          `,
        ]);
      }

      // Fetch existing reservations for this session AND all requested inventory items
      // in ONE query each instead of N separate findFirst calls.
      const itemIds = params.items.map((i) => i.inventoryId);
      const [existing, inventoryRows] = await Promise.all([
        tx.stockReservation.findMany({
          where:  { pharmacyId: params.pharmacyId, sessionId: params.sessionId },
          select: { inventoryId: true, quantity: true },
        }),
        tx.inventory.findMany({
          where:  { id: { in: itemIds }, pharmacyId: params.pharmacyId, status: "ACTIVE" },
          select: { id: true, quantity: true, reservedQuantity: true },
        }),
      ]);

      const existingMap   = new Map(existing.map((r): [string, number] => [r.inventoryId, r.quantity]));
      const inventoryMap  = new Map(inventoryRows.map((r) => [r.id, r]));

      type Conflict = { inventoryId: string; available: number; requested: number };
      const conflicts: Conflict[] = [];
      const results: { inventoryId: string; available: number }[] = [];

      for (const item of params.items) {
        const inv = inventoryMap.get(item.inventoryId);
        if (!inv) continue;
        const thisSessionQty   = existingMap.get(item.inventoryId) ?? 0;
        const reservedByOthers = Math.max(0, inv.reservedQuantity - thisSessionQty);
        const available        = inv.quantity - reservedByOthers;
        results.push({ inventoryId: item.inventoryId, available });
        if (item.quantity > available) conflicts.push({ inventoryId: item.inventoryId, available, requested: item.quantity });
      }

      if (conflicts.length > 0) {
        throw Object.assign(new Error("Insufficient unreserved stock"), { statusCode: 409, conflicts });
      }

      const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);

      // Release old reservations + create new ones — two raw SQL batch ops in parallel.
      const decIds  = [...existingMap.keys()];
      const decQtys = [...existingMap.values()];
      const incIds  = itemIds;
      const incQtys = params.items.map((i) => i.quantity);

      await Promise.all([
        // Delete old reservations for this session
        existing.length > 0
          ? tx.stockReservation.deleteMany({ where: { pharmacyId: params.pharmacyId, sessionId: params.sessionId } })
          : Promise.resolve(),
        // Decrement old reservedQuantity
        decIds.length > 0
          ? tx.$executeRaw`
              UPDATE inventory inv
              SET "reservedQuantity" = GREATEST(0, inv."reservedQuantity" - b.qty)
              FROM (SELECT unnest(${decIds}::text[]) AS id, unnest(${decQtys}::int[]) AS qty) AS b
              WHERE inv.id = b.id AND inv."pharmacyId" = ${params.pharmacyId}::text
            `
          : Promise.resolve(),
        // Create new reservations
        tx.stockReservation.createMany({
          data: params.items.map((item) => ({
            pharmacyId: params.pharmacyId, inventoryId: item.inventoryId,
            sessionId:  params.sessionId,  quantity:    item.quantity, expiresAt,
          })),
        }),
        // Increment new reservedQuantity
        tx.$executeRaw`
          UPDATE inventory inv
          SET "reservedQuantity" = inv."reservedQuantity" + b.qty
          FROM (SELECT unnest(${incIds}::text[]) AS id, unnest(${incQtys}::int[]) AS qty) AS b
          WHERE inv.id = b.id AND inv."pharmacyId" = ${params.pharmacyId}::text
        `,
      ]);

      return results;
    }, { isolationLevel: "Serializable" }).catch((err: { code?: string }) => {
      if (err.code === "P2034") {
        // Serializable conflict — another session updated the same stock concurrently.
        throw Object.assign(new Error("Stock updated concurrently — please refresh and try again"), { statusCode: 409 });
      }
      throw err;
    });
  }

  async releaseReservations(params: { pharmacyId: string; sessionId: string }): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const existing = await tx.stockReservation.findMany({
        where:  { pharmacyId: params.pharmacyId, sessionId: params.sessionId },
        select: { inventoryId: true, quantity: true },
      });
      if (existing.length === 0) return;

      const ids  = existing.map((r) => r.inventoryId);
      const qtys = existing.map((r) => r.quantity);
      await Promise.all([
        tx.stockReservation.deleteMany({ where: { pharmacyId: params.pharmacyId, sessionId: params.sessionId } }),
        tx.$executeRaw`
          UPDATE inventory inv
          SET "reservedQuantity" = GREATEST(0, inv."reservedQuantity" - b.qty)
          FROM (SELECT unnest(${ids}::text[]) AS id, unnest(${qtys}::int[]) AS qty) AS b
          WHERE inv.id = b.id AND inv."pharmacyId" = ${params.pharmacyId}::text
        `,
      ]);
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
    // column-to-column comparison (quantity <= minimumStock) requires raw SQL;
    // fetch matching IDs at the DB level then reload with the full include shape.
    const idRows = await this.db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM inventory
      WHERE  "pharmacyId" = ${pharmacyId}
        AND  status::text = 'ACTIVE'
        AND  quantity     <= "minimumStock"
      ORDER BY quantity ASC
    `;

    if (idRows.length === 0) return [];

    const items = await this.db.inventory.findMany({
      where:   { id: { in: idRows.map((r) => r.id) } },
      include: { medicine: { select: { name: true, genericName: true, form: true } } },
      orderBy: { quantity: "asc" },
    });

    return items.map((i) => ({
      ...i,
      tier: i.quantity === 0             ? "OUT_OF_STOCK" as const
          : i.quantity <= i.reorderLevel ? "REORDER"      as const
                                         : "LOW"          as const,
    }));
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

      // Batch all status updates + movement inserts — replaces 2N sequential queries
      await Promise.all([
        tx.inventory.updateMany({
          where: { id: { in: affected.map((i) => i.id) } },
          data:  { status: "QUARANTINE" },
        }),
        tx.inventoryMovement.createMany({
          data: affected.map((item) => ({
            pharmacyId,
            userId,
            inventoryId:    item.id,
            type:           "ADJUSTMENT" as const,
            direction:      "OUT" as const,
            quantity:       0,
            quantityBefore: item.quantity,
            quantityAfter:  item.quantity,
            referenceType:  "BATCH_RECALL",
            notes:          `RECALL: ${data.reason}`,
          })),
        }),
      ]);

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
