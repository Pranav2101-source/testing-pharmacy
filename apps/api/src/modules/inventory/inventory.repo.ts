import { Prisma, withTenant, type Db, type BatchStatus, type MovementType, type MovementDirection } from "@pharmacy/database";
import { AppError } from "../../lib/AppError.js";
import { env } from "../../config/env.js";
import { computeWasteRisk, computeReorderInsight, computeCalibratedMin } from "./inventory.calc.js";

const RESERVATION_TTL_MS = env.RESERVATION_TTL_MINUTES * 60 * 1000;

const MEDICINE_SELECT = {
  id:          true,
  name:        true,
  genericName: true,
  category:    true,
  form:        true,
  strength:    true,
  unit:        true,
  packSize:    true,
  schedule:    true,
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
  constructor(readonly db: Db) {}

  // Two lightweight COUNT queries run in parallel — both use existing indexes
  // (pharmacyId+status+expiryDate and pharmacyId+status+quantity) so they are
  // sub-millisecond even at 100k rows. Called inside list() via Promise.all.
  async getAlertCounts(pharmacyId: string): Promise<{ expiry: number; lowStock: number }> {
    const d90 = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const [expiryRows, lowRows] = await Promise.all([
      this.db.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) AS count FROM inventory
        WHERE  "pharmacyId" = ${pharmacyId}
          AND  "expiryDate" <= ${d90}
          AND  quantity > 0
          AND  status::text IN ('ACTIVE','EXPIRED')
      `,
      this.db.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) AS count FROM inventory
        WHERE  "pharmacyId" = ${pharmacyId}
          AND  status::text = 'ACTIVE'
          AND  quantity     <= "minimumStock"
      `,
    ]);
    return {
      expiry:   Number(expiryRows[0]?.count  ?? 0),
      lowStock: Number(lowRows[0]?.count ?? 0),
    };
  }

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
    // Enforce mutual exclusivity between shelfId (structured) and location (free-text).
    // shelfId takes precedence when both arrive together.  If neither is provided,
    // preserve existing values by omitting both from the update.
    const locationUpdate =
      data.shelfId !== undefined
        ? { shelfId: data.shelfId, location: null }        // shelf assigned — clear free-text
        : data.location !== undefined
          ? { location: data.location, shelfId: null }     // free-text only — clear shelf
          : {};                                            // neither changed — keep existing

    return this.db.inventory.upsert({
      where: {
        pharmacyId_medicineId_batchNumber: { pharmacyId, medicineId: data.medicineId, batchNumber: data.batchNumber },
      },
      update: {
        quantity:     { increment: data.quantity },
        purchaseRate: data.purchaseRate,
        mrp:          data.mrp,
        expiryDate:   data.expiryDate,
        ...locationUpdate,
        status:       "ACTIVE",
      },
      create: {
        pharmacyId,
        medicineId:   data.medicineId,
        batchNumber:  data.batchNumber,
        expiryDate:   data.expiryDate,
        quantity:     data.quantity,
        purchaseRate: data.purchaseRate,
        mrp:          data.mrp,
        minimumStock: data.minimumStock,
        reorderLevel: data.reorderLevel ?? 5,
        status:       "ACTIVE",
        ...locationUpdate,
      },
      include: INVENTORY_INCLUDE,
    });
  }

  // Adds stock AND atomically writes an InventoryMovement so the addition is
  // traceable in the Stock Ledger ("where did this stock come from?"). Used by
  // manual Add Stock (default OPENING/OPENING_BALANCE labelling) and by the
  // supplier quick-receive path (which passes PURCHASE labelling) — both of
  // which would otherwise silently increment stock with no ledger trail.
  // Returns the saved batch plus whether it merged into an existing batch.
  async addStockWithLedger(pharmacyId: string, userId: string, data: {
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
  }, movement?: {
    type?:          MovementType;
    referenceType?: string;
    referenceId?:   string;
    notes?:         string;
  }): Promise<{ item: unknown; merged: boolean; quantityBefore: number }> {
    return withTenant(this.db, pharmacyId, async (tx) => {
      const existing = await tx.inventory.findUnique({
        where:  { pharmacyId_medicineId_batchNumber: { pharmacyId, medicineId: data.medicineId, batchNumber: data.batchNumber } },
        select: { id: true, quantity: true },
      });
      const quantityBefore = existing?.quantity ?? 0;

      const locationUpdate =
        data.shelfId !== undefined
          ? { shelfId: data.shelfId, location: null }
          : data.location !== undefined
            ? { location: data.location, shelfId: null }
            : {};

      const item = await tx.inventory.upsert({
        where: {
          pharmacyId_medicineId_batchNumber: { pharmacyId, medicineId: data.medicineId, batchNumber: data.batchNumber },
        },
        update: {
          quantity:     { increment: data.quantity },
          purchaseRate: data.purchaseRate,
          mrp:          data.mrp,
          expiryDate:   data.expiryDate,
          ...locationUpdate,
          status:       "ACTIVE",
        },
        create: {
          pharmacyId,
          medicineId:   data.medicineId,
          batchNumber:  data.batchNumber,
          expiryDate:   data.expiryDate,
          quantity:     data.quantity,
          purchaseRate: data.purchaseRate,
          mrp:          data.mrp,
          minimumStock: data.minimumStock,
          reorderLevel: data.reorderLevel ?? 5,
          status:       "ACTIVE",
          ...locationUpdate,
        },
        include: INVENTORY_INCLUDE,
      });

      await tx.inventoryMovement.create({
        data: {
          pharmacyId,
          userId,
          inventoryId:    item.id,
          type:           (movement?.type ?? "OPENING") as MovementType,
          direction:      "IN" as MovementDirection,
          quantity:       data.quantity,
          quantityBefore,
          quantityAfter:  quantityBefore + data.quantity,
          referenceType:  movement?.referenceType ?? "OPENING_BALANCE",
          referenceId:    movement?.referenceId,
          notes:          movement?.notes ?? (existing ? "Manual stock entry (added to existing batch)" : "Manual stock entry (new batch)"),
        },
      });

      return { item, merged: Boolean(existing), quantityBefore };
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

      const [countRows, idRows, alertCounts] = await Promise.all([
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
        this.getAlertCounts(pharmacyId),
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
        alertCounts,
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

    const [items, total, alertCounts] = await Promise.all([
      this.db.inventory.findMany({
        where,
        orderBy: [{ expiryDate: "asc" }, { createdAt: "desc" }],
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
        include: INVENTORY_INCLUDE,
      }),
      this.db.inventory.count({ where }),
      this.getAlertCounts(pharmacyId),
    ]);

    return { items, total, page: params.page, limit: params.limit, alertCounts };
  }

  async getById(id: string, pharmacyId: string) {
    return this.db.inventory.findFirst({
      where:   { id, pharmacyId },
      include: INVENTORY_INCLUDE,
    });
  }

  async updateBatchStatus(id: string, pharmacyId: string, userId: string, status: string, reason: string) {
    return withTenant(this.db, pharmacyId, async (tx) => {
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
          referenceType:  "STATUS_CHANGE",
          notes:          `${item.status}→${status}${reason ? `: ${reason}` : ""}`,
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
    return withTenant(this.db, params.pharmacyId, async (tx) => {
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
    cursor?:      string;
    inventoryId?: string;
    medicineId?:  string;
    userId?:      string;
    type?:        string;
    direction?:   string;
    from?:        Date;
    to?:          Date;
  }) {
    const where: Prisma.InventoryMovementWhereInput = {
      pharmacyId,
      ...(params.inventoryId ? { inventoryId: params.inventoryId } : {}),
      ...(params.userId      ? { userId:      params.userId }      : {}),
      ...(params.type        ? { type: params.type as MovementType } : {}),
      ...(params.direction   ? { direction: params.direction as MovementDirection } : {}),
      ...(params.from || params.to
        ? { createdAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
        : {}),
      ...(params.medicineId
        ? { inventory: { medicineId: params.medicineId } }
        : {}),
    };

    const include = {
      inventory: {
        select: {
          batchNumber: true,
          medicine:    { select: { name: true, genericName: true } },
        },
      },
      user: { select: { id: true, name: true } },
    } as const;

    if (params.cursor) {
      const movements = await this.db.inventoryMovement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        cursor:  { id: params.cursor },
        skip:    1,
        take:    params.limit,
        include,
      });
      const nextCursor = movements.length === params.limit ? movements[movements.length - 1]?.id : undefined;
      return { movements, nextCursor, page: params.page, limit: params.limit };
    }

    const [movements, total] = await Promise.all([
      this.db.inventoryMovement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
        include,
      }),
      this.db.inventoryMovement.count({ where }),
    ]);

    const nextCursor = movements.length === params.limit ? movements[movements.length - 1]?.id : undefined;
    return { movements, total, nextCursor, page: params.page, limit: params.limit };
  }

  // ── Stock Reservation ─────────────────────────────────────────────────────

  async upsertReservations(params: {
    pharmacyId: string;
    sessionId:  string;
    items:      { inventoryId: string; quantity: number }[];
  }): Promise<{ inventoryId: string; available: number }[]> {
    return withTenant(this.db, params.pharmacyId, async (tx) => {
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
        if (!inv) {
          throw AppError.notFound(`Inventory item not found or not active: ${item.inventoryId}`);
        }
        const thisSessionQty   = existingMap.get(item.inventoryId) ?? 0;
        const reservedByOthers = Math.max(0, inv.reservedQuantity - thisSessionQty);
        const available        = inv.quantity - reservedByOthers;
        results.push({ inventoryId: item.inventoryId, available });
        if (item.quantity > available) conflicts.push({ inventoryId: item.inventoryId, available, requested: item.quantity });
      }

      if (conflicts.length > 0) {
        throw AppError.conflict("Insufficient unreserved stock", { conflicts });
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
        throw AppError.conflict("Stock updated concurrently — please refresh and try again");
      }
      throw err;
    });
  }

  async releaseReservations(params: { pharmacyId: string; sessionId: string }): Promise<void> {
    await withTenant(this.db, params.pharmacyId, async (tx) => {
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

  // Single batched query — sums sales for all requested medicines over the
  // given window (days) without N+1 trips. Uses LEFT JOIN so medicines with
  // zero sales still appear in the result map (mapped to 0).
  private async getMedicineDailySales(
    pharmacyId:  string,
    medicineIds: string[],
    windowDays:  number,
  ): Promise<Map<string, number>> {
    if (medicineIds.length === 0) return new Map();
    const fromDate = new Date(Date.now() - windowDays * 86_400_000);
    const idList   = Prisma.join(medicineIds.map((id) => Prisma.sql`${id}`));

    const rows = await this.db.$queryRaw<Array<{ medicineId: string; avgDaily: number }>>`
      SELECT
        i."medicineId",
        COALESCE(SUM(mv.quantity), 0)::float / ${windowDays} AS "avgDaily"
      FROM inventory i
      LEFT JOIN "inventory_movements" mv
            ON  mv."inventoryId" = i.id
           AND  mv.direction     = 'OUT'
           AND  mv.type          = 'SALE'
           AND  mv."createdAt"  >= ${fromDate}
      WHERE i."pharmacyId" = ${pharmacyId}
        AND i."medicineId" IN (${idList})
      GROUP BY i."medicineId"
    `;

    return new Map(rows.map((r) => [r.medicineId, Number(r.avgDaily)]));
  }

  async getExpiryAlerts(pharmacyId: string) {
    const now = new Date();
    const d30 = new Date(Date.now() +  30 * 86400_000);
    const d60 = new Date(Date.now() +  60 * 86400_000);
    const d90 = new Date(Date.now() +  90 * 86400_000);

    const items = await this.db.inventory.findMany({
      // ACTIVE + EXPIRED only: QUARANTINE/DAMAGED are handled through recall/
      // adjustment flows and would only add noise here.
      where: {
        pharmacyId,
        expiryDate: { lte: d90 },
        quantity:   { gt: 0 },
        status:     { in: ["ACTIVE", "EXPIRED"] },
      },
      include: { medicine: { select: { name: true, genericName: true, form: true } } },
      orderBy: { expiryDate: "asc" },
    });

    if (items.length === 0) return [];

    // One batched query for 30-day avg daily sales — no N+1
    const medicineIds = [...new Set(items.map((i) => i.medicineId))];
    const salesMap    = await this.getMedicineDailySales(pharmacyId, medicineIds, 30);

    return items.map((i) => {
      const daysToExpiry = Math.ceil((i.expiryDate.getTime() - now.getTime()) / 86400_000);
      const tier = i.expiryDate <= now ? "EXPIRED"  as const
                 : i.expiryDate <= d30 ? "CRITICAL" as const
                 : i.expiryDate <= d60 ? "WARNING"  as const
                                       : "NOTICE"   as const;

      const avgDailySales = salesMap.get(i.medicineId) ?? 0;
      const hasData       = salesMap.has(i.medicineId);
      const wasteRisk     = computeWasteRisk(
        i.quantity, daysToExpiry, tier === "EXPIRED",
        avgDailySales, hasData, Number(i.purchaseRate),
      );

      return { ...i, tier, daysToExpiry, wasteRisk };
    });
  }

  async getLowStockAlerts(pharmacyId: string) {
    // Column-to-column comparison (quantity <= minimumStock) requires raw SQL.
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

    const medicineIds = [...new Set(items.map((i) => i.medicineId))];
    const salesMap    = await this.getMedicineDailySales(pharmacyId, medicineIds, 30);

    const COVER_DAYS     = 30;
    const LEAD_TIME_DAYS = 7;

    return items.map((i) => {
      const tier = i.quantity === 0             ? "OUT_OF_STOCK" as const
                 : i.quantity <= i.reorderLevel ? "REORDER"      as const
                                                : "LOW"          as const;

      const avgDailySales = salesMap.get(i.medicineId) ?? 0;
      const hasData       = salesMap.has(i.medicineId) && avgDailySales > 0;
      const reorder       = computeReorderInsight(avgDailySales, hasData, COVER_DAYS, LEAD_TIME_DAYS);

      return { ...i, tier, reorder };
    });
  }

  // Analyzes windowDays of sales and recalculates minimumStock for every
  // active medicine. Returns a preview of proposed changes; dryRun=true
  // skips the DB write so the UI can show a confirmation screen first.
  async calibrateMinimumStock(pharmacyId: string, dryRun: boolean) {
    const WINDOW_DAYS    = 90;
    const LEAD_TIME_DAYS = 7;
    const SAFETY_FACTOR  = 1.5;
    const MIN_FLOOR      = 5;   // never set below 5 even for very slow movers

    // One representative row per medicine (most recently created batch)
    const medicineRows = await this.db.$queryRaw<
      Array<{ medicineId: string; medicineName: string; currentMin: number }>
    >`
      SELECT DISTINCT ON (i."medicineId")
        i."medicineId",
        m.name        AS "medicineName",
        i."minimumStock" AS "currentMin"
      FROM inventory i
      JOIN medicines m ON m.id = i."medicineId"
      WHERE i."pharmacyId" = ${pharmacyId}
        AND i.status       = 'ACTIVE'
      ORDER BY i."medicineId", i."createdAt" DESC
    `;

    if (medicineRows.length === 0) return { updated: 0, skipped: 0, analyzed: 0, changes: [] };

    const medIds   = medicineRows.map((r) => r.medicineId);
    const salesMap = await this.getMedicineDailySales(pharmacyId, medIds, WINDOW_DAYS);

    type CalibrateChange = {
      medicineId:    string;
      medicineName:  string;
      oldMin:        number;
      newMin:        number;
      avgDailySales: number;
    };

    const changes: CalibrateChange[] = [];
    let skipped = 0;

    for (const row of medicineRows) {
      const avgDaily = salesMap.get(row.medicineId) ?? 0;
      if (avgDaily === 0) { skipped++; continue; }

      const newMin = computeCalibratedMin(avgDaily, LEAD_TIME_DAYS, SAFETY_FACTOR, MIN_FLOOR);
      if (newMin === row.currentMin) continue; // already optimal

      changes.push({
        medicineId:    row.medicineId,
        medicineName:  row.medicineName,
        oldMin:        row.currentMin,
        newMin,
        avgDailySales: Math.round(avgDaily * 10) / 10,
      });
    }

    if (!dryRun && changes.length > 0) {
      const ids     = changes.map((c) => c.medicineId);
      const newMins = changes.map((c) => c.newMin);
      // Single SQL statement updates all medicines in one round-trip
      await this.db.$executeRaw`
        UPDATE inventory inv
        SET "minimumStock" = b.new_min::integer
        FROM (
          SELECT
            unnest(${ids}::text[])        AS medicine_id,
            unnest(${newMins}::integer[]) AS new_min
        ) AS b
        WHERE inv."medicineId" = b.medicine_id
          AND inv."pharmacyId" = ${pharmacyId}
          AND inv.status       = 'ACTIVE'
      `;
    }

    return { updated: changes.length, skipped, analyzed: medicineRows.length, changes };
  }

  // ── FEFO batch selection (used by billing) ─────────────────────────────────

  async getFEFOBatch(medicineId: string, pharmacyId: string, quantity: number) {
    // Prisma cannot express a column-to-column comparison in WHERE, so we use
    // $queryRaw to filter (quantity - reservedQuantity) >= ? at the DB level.
    // This avoids the two-stage scan+filter pattern that could miss valid batches
    // sitting beyond an arbitrary in-memory take() cap.
    const rows = await this.db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM inventory
      WHERE  "pharmacyId" = ${pharmacyId}
        AND  "medicineId" = ${medicineId}
        AND  status       = 'ACTIVE'
        AND  "expiryDate" > ${new Date()}
        AND  (quantity - "reservedQuantity") >= ${quantity}
      ORDER BY "expiryDate" ASC
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return this.db.inventory.findFirst({ where: { id: rows[0]!.id } });
  }

  // ── Batch Recall ───────────────────────────────────────────────────────────

  async batchRecall(pharmacyId: string, userId: string, data: {
    batchNumber: string;
    medicineId?: string;
    reason:      string;
  }) {
    return withTenant(this.db, pharmacyId, async (tx) => {
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
        throw AppError.notFound("No ACTIVE batches found matching the given batch number");

      const affectedIds = affected.map((i) => i.id);

      // 1. Create the authoritative recall record first so we have its ID.
      const recall = await tx.batchRecall.create({
        data: {
          pharmacyId,
          batchNumber: data.batchNumber,
          medicineId:  data.medicineId ?? null,
          reason:      data.reason,
          recalledBy:  userId,
          affectedIds,
        },
      });

      // 2. Quarantine affected batches + write one ledger movement per item.
      //    referenceId links each movement back to the BatchRecall row.
      await Promise.all([
        tx.inventory.updateMany({
          where: { id: { in: affectedIds } },
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
            referenceId:    recall.id,
            notes:          data.reason,
          })),
        }),
      ]);

      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId,
          action:  "CREATE",
          entity:  "BatchRecall",
          entityId: recall.id,
          newData: {
            batchNumber:   data.batchNumber,
            medicineId:    data.medicineId,
            reason:        data.reason,
            affectedCount: affected.length,
            affectedIds,
          },
        },
      });

      return { affectedCount: affected.length, recallId: recall.id, items: affected };
    });
  }

  // ── Encapsulated helpers (keeps service layer off repo.db) ───────────────────

  async getMedicineOverrides(pharmacyId: string, medicineIds: string[]) {
    if (medicineIds.length === 0) return [];
    return this.db.pharmacyMedicineOverride.findMany({
      where: { pharmacyId, medicineId: { in: medicineIds } },
    });
  }

  async updateInventoryLocation(
    id:         string,
    pharmacyId: string,
    data: { shelfId: string | null; location: string | null },
  ) {
    return this.db.inventory.update({ where: { id, pharmacyId }, data, include: INVENTORY_INCLUDE });
  }

  async listRecalledBatches(pharmacyId: string, params: {
    page:         number;
    limit:        number;
    batchNumber?: string;
  }) {
    // Query the dedicated BatchRecall table — no longer relies on string probing InventoryMovement.
    const where = {
      pharmacyId,
      ...(params.batchNumber
        ? { batchNumber: { contains: params.batchNumber, mode: "insensitive" as const } }
        : {}),
    };

    const [recalls, total] = await Promise.all([
      this.db.batchRecall.findMany({
        where,
        include: {
          medicine: { select: { id: true, name: true, genericName: true } },
          user:     { select: { id: true, name: true } },
        },
        orderBy: { recalledAt: "desc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.db.batchRecall.count({ where }),
    ]);

    return { items: recalls, total, page: params.page, limit: params.limit };
  }

  async getFrequent(pharmacyId: string, limit = 10) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const topNames = await this.db.$queryRaw<{ medicine_name: string; freq: bigint }[]>`
      SELECT "medicineName" AS medicine_name, COUNT(*) AS freq
      FROM invoice_items
      WHERE "pharmacyId" = ${pharmacyId}
        AND "createdAt" >= ${since}
      GROUP BY "medicineName"
      ORDER BY freq DESC
      LIMIT ${Prisma.raw(String(limit))}
    `;
    if (topNames.length === 0) return [];
    const results = await Promise.all(
      topNames.map(async ({ medicine_name, freq }) => {
        const batch = await this.db.inventory.findFirst({
          where: {
            pharmacyId,
            quantity: { gt: 0 },
            expiryDate: { gt: new Date() },
            status: "ACTIVE",
            medicine: { name: { equals: medicine_name, mode: "insensitive" } },
          },
          orderBy: { expiryDate: "asc" },
          include: INVENTORY_INCLUDE,
        });
        if (!batch) return null;
        return { ...batch, freq: Number(freq) };
      }),
    );
    return results.filter((r): r is NonNullable<typeof r> => r !== null);
  }
}
