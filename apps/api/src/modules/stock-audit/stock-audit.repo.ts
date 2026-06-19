import type { Db, Prisma } from "@pharmacy/database"
import { withTenant } from "@pharmacy/database"
import { AppError } from "../../lib/AppError.js"
import type {
  ApproveSessionInput,
  CompleteSessionInput,
  CreateSessionInput,
  ListSessionsQuery,
  UpdateItemInput,
} from "./stock-audit.schema.js"

// Prisma interactive-transaction client type (same as Db minus the
// transaction-management methods — avoids `tx: any` which silently disables
// all type checking inside the transaction body).
type TxClient = Omit<Db, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">

const ITEM_INCLUDE = {
  inventory: {
    select: {
      id: true,
      batchNumber: true,
      expiryDate: true,
      quantity: true,
      location: true,
      mrp: true,
      purchaseRate: true,
      medicine: { select: { id: true, name: true, genericName: true, form: true, strength: true } },
      shelf: { select: { id: true, code: true, level: true, rack: { select: { id: true, code: true, name: true } } } },
    },
  },
} as const

export class StockAuditRepo {
  constructor(private db: Db) {}

  // ── Create session ──────────────────────────────────────────────────────────
  // Fix #5: Wrap snapshot read + session create in a SINGLE Serializable
  //   transaction so the expectedQty values are consistent with the session rows.
  //   Previously the two operations were in separate transactions; sales between
  //   them made expectedQty stale before the first count even started.
  // Fix #2: Accept pre-generated sessionNumber (Redis INCR in service) instead
  //   of COUNT(*) which races under concurrent creates.
  // Fix #8 (IST): IST midnight for today-count is now irrelevant since we no
  //   longer count sessions today — the number comes from the caller.

  async createSession(pharmacyId: string, userId: string, sessionNumber: string, data: CreateSessionInput) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      const activeInventory = await tx.inventory.findMany({
        where:  { pharmacyId, status: "ACTIVE" },
        select: { id: true, quantity: true },
      })

      if (activeInventory.length === 0)
        throw AppError.unprocessable("No active inventory batches found. Add inventory before running a stock audit.")

      return tx.stockAuditSession.create({
        data: {
          pharmacyId,
          sessionNumber,
          createdBy: userId,
          notes:     data.notes,
          items: {
            create: activeInventory.map((inv) => ({
              pharmacyId,
              inventoryId: inv.id,
              expectedQty: inv.quantity,
            })),
          },
        },
        include: {
          items: { include: ITEM_INCLUDE, orderBy: { createdAt: "asc" } },
          _count: { select: { items: true } },
        },
      })
    }, { isolationLevel: "Serializable" })
  }

  // ── Start session ───────────────────────────────────────────────────────────
  // Fix #12: Use updateMany so the WHERE clause can include pharmacyId (Prisma's
  //   update requires a unique-constraint selector; updateMany does not).
  //   This prevents an accidental cross-tenant write if the session id is somehow
  //   shared across tenants.

  async startSession(id: string, pharmacyId: string) {
    const result = await this.db.stockAuditSession.updateMany({
      where: { id, pharmacyId, status: "DRAFT" },
      data:  { status: "IN_PROGRESS", startedAt: new Date() },
    })
    if (result.count === 0) {
      const session = await this.db.stockAuditSession.findFirst({ where: { id, pharmacyId } })
      if (!session) throw AppError.notFound("Audit session not found")
      throw AppError.conflict(`Cannot start a session in ${session.status} status`)
    }
    const updated = await this.db.stockAuditSession.findFirst({
      where:   { id, pharmacyId },
      include: { items: { include: ITEM_INCLUDE }, _count: { select: { items: true } } },
    })
    if (!updated) throw AppError.notFound("Audit session not found after start")
    return updated
  }

  // ── Update item ─────────────────────────────────────────────────────────────

  async updateItem(sessionId: string, itemId: string, pharmacyId: string, data: UpdateItemInput) {
    const session = await this.db.stockAuditSession.findFirst({ where: { id: sessionId, pharmacyId } })
    if (!session) throw AppError.notFound("Audit session not found")
    if (session.status !== "IN_PROGRESS")
      throw AppError.conflict("Can only update items when session is IN_PROGRESS")

    const item = await this.db.stockAuditItem.findFirst({ where: { id: itemId, sessionId } })
    if (!item) throw AppError.notFound("Audit item not found")

    return this.db.stockAuditItem.update({
      where: { id: itemId },
      data: {
        ...(data.countedQty !== undefined
          ? { countedQty: data.countedQty, varianceQty: data.countedQty - item.expectedQty }
          : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
      include: ITEM_INCLUDE,
    })
  }

  // ── Complete session ────────────────────────────────────────────────────────
  // Fix #4: Wrap in a transaction with status guard in the WHERE clause so a
  //   concurrent cancelSession cannot slip between the status check and the
  //   update.  Previously the findFirst check and the update were two separate
  //   DB calls with no transaction wrapping them.

  async completeSession(id: string, pharmacyId: string, userId: string, data: CompleteSessionInput) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      const uncounted = await tx.stockAuditItem.count({
        where: { sessionId: id, countedQty: null },
      })
      if (uncounted > 0)
        throw AppError.unprocessable(`${uncounted} item(s) still uncounted. Count all items before completing.`)

      const result = await tx.stockAuditSession.updateMany({
        where: { id, pharmacyId, status: "IN_PROGRESS" },
        data:  { status: "COMPLETED", completedAt: new Date(), ...(data.notes ? { notes: data.notes } : {}) },
      })

      if (result.count === 0) {
        const session = await tx.stockAuditSession.findFirst({ where: { id, pharmacyId } })
        if (!session) throw AppError.notFound("Audit session not found")
        throw AppError.conflict(`Cannot complete a session in ${session.status} status`)
      }

      return tx.stockAuditSession.findFirst({
        where:   { id, pharmacyId },
        include: {
          items:  { include: ITEM_INCLUDE, orderBy: { createdAt: "asc" } },
          _count: { select: { items: true } },
        },
      })
    })
  }

  // ── Approve session ─────────────────────────────────────────────────────────
  // Fix #6: Replace `tx: any` with proper TxClient type.
  // Fix #1: Set finalQty = item.countedQty (not inventory.quantity + varianceQty).
  //   The old formula produced wrong results when sales occurred between the count
  //   and the approval: live qty changed, so live + variance no longer equalled
  //   the physically counted value.  The correct formula is: "set the shelf to
  //   exactly what the staff physically counted."
  // Also batched the per-item inventory reads + writes to reduce the N×3
  //   sequential awaits inside the Serializable lock window.

  async approveSession(id: string, pharmacyId: string, userId: string, data: ApproveSessionInput) {
    return withTenant(this.db, pharmacyId, async (tx) => {
          const session = await tx.stockAuditSession.findFirst({
            where:   { id, pharmacyId },
            include: { items: true },
          })
          if (!session) throw AppError.notFound("Audit session not found")
          if (session.status !== "COMPLETED")
            throw AppError.conflict("Only COMPLETED sessions can be approved")

          // Only process items that have a non-zero variance and a recorded count.
          const variantItems = session.items.filter(
            (i) => i.varianceQty !== 0 && i.varianceQty !== null && i.countedQty !== null,
          )

          if (variantItems.length > 0) {
            // Batch read all affected inventory rows in one query.
            const inventoryRows = await tx.inventory.findMany({
              where:  { id: { in: variantItems.map((i) => i.inventoryId) } },
              select: { id: true, quantity: true, status: true },
            })
            const invMap = new Map(inventoryRows.map((r) => [r.id, r]))

            // Collect adjustments — only for ACTIVE batches.
            type Adj = { invId: string; qtyBefore: number; qtyAfter: number; varianceQty: number; countedQty: number }
            const adjustments: Adj[] = []
            for (const item of variantItems) {
              const inv = invMap.get(item.inventoryId)
              if (!inv || inv.status !== "ACTIVE") continue
              adjustments.push({
                invId:       item.inventoryId,
                qtyBefore:   inv.quantity,
                // Correct formula: set to the physically counted value so sales
                // that happened after the count don't corrupt the final quantity.
                qtyAfter:    Math.max(0, item.countedQty!),
                varianceQty: item.varianceQty!,
                countedQty:  item.countedQty!,
              })
            }

            if (adjustments.length > 0) {
              // Batch UPDATE inventory via a single raw statement instead of N sequential updates.
              const ids    = adjustments.map((a) => a.invId)
              const qtys   = adjustments.map((a) => a.qtyAfter)
              await tx.$executeRaw`
                UPDATE inventory inv
                SET    quantity = b.qty
                FROM   (SELECT unnest(${ids}::text[]) AS id, unnest(${qtys}::int[]) AS qty) AS b
                WHERE  inv.id           = b.id
                  AND  inv."pharmacyId" = ${pharmacyId}::text
              ` as unknown as Prisma.PrismaPromise<number>

              // Batch create inventory movements.
              await tx.inventoryMovement.createMany({
                data: adjustments.map((a) => ({
                  pharmacyId,
                  inventoryId:    a.invId,
                  userId,
                  type:           "ADJUSTMENT" as const,
                  direction:      (a.varianceQty > 0 ? "IN" : "OUT") as "IN" | "OUT",
                  quantity:       Math.abs(a.varianceQty),
                  quantityBefore: a.qtyBefore,
                  quantityAfter:  a.qtyAfter,
                  referenceType:  "StockAuditSession",
                  referenceId:    id,
                  notes:          `Stock audit ${session.sessionNumber}: variance ${a.varianceQty > 0 ? "+" : ""}${a.varianceQty}`,
                })),
              })
            }
          }

          await tx.auditLog.create({
            data: {
              pharmacyId,
              userId,
              action:   "APPROVE",
              entity:   "StockAuditSession",
              entityId: id,
              newData:  {
                sessionNumber:     session.sessionNumber,
                totalItems:        session.items.length,
                itemsWithVariance: variantItems.length,
                notes:             data.notes,
              } as Prisma.InputJsonValue,
            },
          })

          // Use updateMany so pharmacyId is in the WHERE — prevents a cross-tenant
          // write if a session id from another pharmacy is somehow known to the caller.
          await tx.stockAuditSession.updateMany({
            where: { id, pharmacyId },
            data:  { status: "APPROVED", approvedAt: new Date(), approvedBy: userId },
          })

          return tx.stockAuditSession.findFirst({
            where:   { id, pharmacyId },
            include: {
              items:    { include: ITEM_INCLUDE, orderBy: { createdAt: "asc" } },
              _count:   { select: { items: true } },
              approver: { select: { id: true, name: true } },
            },
          })
    }, { isolationLevel: "Serializable", timeout: 20_000 })
      .catch((err: { code?: string }) => {
        if (err.code === "P2034") throw AppError.conflict("Concurrent modification — please retry")
        throw err
      })
  }

  // ── Cancel session ──────────────────────────────────────────────────────────
  // Fix #4: Wrap in a transaction so the status check and the update are atomic.
  //   Previously, audit log was written BEFORE the update (so a failed update left
  //   a phantom log entry), and a concurrent completeSession could slip between the
  //   findFirst check and the update.
  // Fix #12: updateMany with pharmacyId to scope the write to this tenant.

  async cancelSession(id: string, pharmacyId: string, userId: string) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      // Read the pre-cancel state first so the audit log records the OLD status.
      const before = await tx.stockAuditSession.findFirst({
        where:  { id, pharmacyId },
        select: { sessionNumber: true, status: true },
      })

      if (!before) throw AppError.notFound("Audit session not found")
      if (!["DRAFT", "IN_PROGRESS"].includes(before.status))
        throw AppError.conflict(`Cannot cancel a session in ${before.status} status`)

      const result = await tx.stockAuditSession.updateMany({
        where: { id, pharmacyId, status: { in: ["DRAFT", "IN_PROGRESS"] } },
        data:  { status: "CANCELLED" },
      })
      // A concurrent state transition (e.g. COMPLETED by another user) can slip
      // between the findFirst check and the updateMany.  If that happened the
      // WHERE clause matched nothing — treat it as a conflict.
      if (result.count === 0)
        throw AppError.conflict("Session state changed concurrently — please refresh and try again")

      // Audit log is inside the transaction — only written when the cancellation commits.
      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId,
          action:   "DELETE",
          entity:   "StockAuditSession",
          entityId: id,
          oldData:  { sessionNumber: before.sessionNumber, status: before.status } as Prisma.InputJsonValue,
          newData:  { status: "CANCELLED" } as Prisma.InputJsonValue,
        },
      })

      const cancelled = await tx.stockAuditSession.findFirst({ where: { id, pharmacyId } })
      if (!cancelled) throw AppError.notFound("Audit session not found after cancel")
      return cancelled
    })
  }

  // ── Read helpers ────────────────────────────────────────────────────────────

  async getSession(id: string, pharmacyId: string) {
    return this.db.stockAuditSession.findFirst({
      where: { id, pharmacyId },
      include: {
        items: {
          include:  ITEM_INCLUDE,
          orderBy:  { createdAt: "asc" },
        },
        _count:   { select: { items: true } },
        approver: { select: { id: true, name: true } },
      },
    })
  }

  async getVarianceSummary(id: string, pharmacyId: string) {
    const session = await this.db.stockAuditSession.findFirst({
      where:   { id, pharmacyId },
      include: {
        items: {
          where:   { varianceQty: { not: 0 }, NOT: { varianceQty: null } },
          include: ITEM_INCLUDE,
          orderBy: { createdAt: "asc" },
        },
      },
    })
    if (!session) throw AppError.notFound("Audit session not found")

    const adjustments = session.items.map((item) => ({
      inventoryId:  item.inventoryId,
      medicineName: item.inventory.medicine.name,
      batchNumber:  item.inventory.batchNumber,
      expiryDate:   item.inventory.expiryDate,
      currentQty:   item.inventory.quantity,
      expectedQty:  item.expectedQty,
      countedQty:   item.countedQty,
      varianceQty:  item.varianceQty,
      direction:    (item.varianceQty! > 0 ? "IN" : "OUT") as "IN" | "OUT",
      // resultQty reflects what approveSession will set (countedQty, not live+variance)
      resultQty:    Math.max(0, item.countedQty ?? 0),
    }))

    const totalIn  = adjustments.filter((a) => a.direction === "IN").reduce((s, a) => s + a.varianceQty!, 0)
    const totalOut = adjustments.filter((a) => a.direction === "OUT").reduce((s, a) => s + Math.abs(a.varianceQty!), 0)

    return {
      sessionId:     id,
      sessionNumber: session.sessionNumber,
      status:        session.status,
      totalItems:    session.items.length,
      adjustments,
      summary: { totalIn, totalOut, netVariance: totalIn - totalOut },
    }
  }

  async listSessions(pharmacyId: string, params: ListSessionsQuery) {
    const where = {
      pharmacyId,
      ...(params.status ? { status: params.status } : {}),
    }

    const [items, total] = await Promise.all([
      this.db.stockAuditSession.findMany({
        where,
        include: { _count: { select: { items: true } } },
        orderBy: { createdAt: "desc" },
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
      }),
      this.db.stockAuditSession.count({ where }),
    ])

    const enriched = await Promise.all(
      items.map(async (session) => {
        const [counted, withVariance] = await Promise.all([
          this.db.stockAuditItem.count({ where: { sessionId: session.id, countedQty: { not: null } } }),
          this.db.stockAuditItem.count({
            where: { sessionId: session.id, varianceQty: { not: 0 }, NOT: { varianceQty: null } },
          }),
        ])
        return { ...session, countedItems: counted, itemsWithVariance: withVariance }
      }),
    )

    return { items: enriched, total, page: params.page, limit: params.limit }
  }
}
