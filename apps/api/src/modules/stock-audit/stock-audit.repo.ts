import type { PrismaClient } from "@pharmacy/database"
import { AppError } from "../../lib/AppError.js"
import type {
  ApproveSessionInput,
  CompleteSessionInput,
  CreateSessionInput,
  ListSessionsQuery,
  UpdateItemInput,
} from "./stock-audit.schema.js"

const ITEM_INCLUDE = {
  inventory: {
    select: {
      id: true,
      batchNumber: true,
      expiryDate: true,
      quantity: true,
      location: true,
      medicine: { select: { id: true, name: true, genericName: true, form: true, strength: true } },
      shelf: { select: { id: true, code: true, rack: { select: { id: true, code: true, name: true } } } },
    },
  },
} as const

function generateSessionNumber(date: Date, seq: number) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `AUDIT-${y}${m}${d}-${String(seq).padStart(3, "0")}`
}

export class StockAuditRepo {
  constructor(private db: PrismaClient) {}

  async createSession(pharmacyId: string, userId: string, data: CreateSessionInput) {
    const now = new Date()

    // Count sessions today to generate sequential number
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayCount = await this.db.stockAuditSession.count({
      where: { pharmacyId, createdAt: { gte: todayStart } },
    })
    const sessionNumber = generateSessionNumber(now, todayCount + 1)

    // Snapshot all ACTIVE inventory with quantity > 0
    const activeInventory = await this.db.inventory.findMany({
      where: { pharmacyId, status: "ACTIVE", quantity: { gt: 0 } },
      select: { id: true, quantity: true },
    })

    if (activeInventory.length === 0)
      throw AppError.unprocessable("No active inventory items to audit")

    return this.db.stockAuditSession.create({
      data: {
        pharmacyId,
        sessionNumber,
        createdBy: userId,
        notes: data.notes,
        items: {
          create: activeInventory.map((inv: { id: string; quantity: number }) => ({
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
  }

  async startSession(id: string, pharmacyId: string) {
    const session = await this.db.stockAuditSession.findFirst({ where: { id, pharmacyId } })
    if (!session) throw AppError.notFound("Audit session not found")
    if (session.status !== "DRAFT")
      throw AppError.conflict(`Cannot start a session in ${session.status} status`)

    return this.db.stockAuditSession.update({
      where: { id },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
    })
  }

  async updateItem(sessionId: string, itemId: string, pharmacyId: string, data: UpdateItemInput) {
    const session = await this.db.stockAuditSession.findFirst({ where: { id: sessionId, pharmacyId } })
    if (!session) throw AppError.notFound("Audit session not found")
    if (session.status !== "IN_PROGRESS")
      throw AppError.conflict("Can only update items when session is IN_PROGRESS")

    const item = await this.db.stockAuditItem.findFirst({
      where: { id: itemId, sessionId },
    })
    if (!item) throw AppError.notFound("Audit item not found")

    return this.db.stockAuditItem.update({
      where: { id: itemId },
      data: {
        countedQty: data.countedQty,
        varianceQty: data.countedQty - item.expectedQty,
        notes: data.notes,
      },
      include: ITEM_INCLUDE,
    })
  }

  async completeSession(id: string, pharmacyId: string, userId: string, data: CompleteSessionInput) {
    const session = await this.db.stockAuditSession.findFirst({
      where: { id, pharmacyId },
      include: { _count: { select: { items: true } } },
    })
    if (!session) throw AppError.notFound("Audit session not found")
    if (session.status !== "IN_PROGRESS")
      throw AppError.conflict(`Cannot complete a session in ${session.status} status`)

    const uncounted = await this.db.stockAuditItem.count({
      where: { sessionId: id, countedQty: null },
    })
    if (uncounted > 0)
      throw AppError.unprocessable(`${uncounted} item(s) still uncounted. Count all items before completing.`)

    return this.db.stockAuditSession.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        notes: data.notes ?? session.notes,
      },
    })
  }

  async approveSession(id: string, pharmacyId: string, userId: string, data: ApproveSessionInput) {
    return this.db
      .$transaction(
        async (tx: any) => {
          const session = await tx.stockAuditSession.findFirst({
            where: { id, pharmacyId },
            include: { items: true },
          })
          if (!session) throw AppError.notFound("Audit session not found")
          if (session.status !== "COMPLETED")
            throw AppError.conflict("Only COMPLETED sessions can be approved")

          // Apply variances
          for (const item of session.items) {
            if (item.varianceQty === 0 || item.varianceQty === null) continue

            const inventory = await tx.inventory.findUnique({
              where: { id: item.inventoryId },
            })
            if (!inventory || inventory.status !== "ACTIVE") continue

            const newQty = inventory.quantity + item.varianceQty
            const finalQty = Math.max(0, newQty) // floor at 0

            await tx.inventory.update({
              where: { id: item.inventoryId },
              data: { quantity: finalQty },
            })

            await tx.inventoryMovement.create({
              data: {
                pharmacyId,
                inventoryId: item.inventoryId,
                userId,
                type: "ADJUSTMENT",
                direction: item.varianceQty > 0 ? "IN" : "OUT",
                quantity: Math.abs(item.varianceQty),
                quantityBefore: inventory.quantity,
                quantityAfter: finalQty,
                referenceType: "StockAuditSession",
                referenceId: id,
                notes: `Stock audit ${session.sessionNumber}: variance ${item.varianceQty > 0 ? "+" : ""}${item.varianceQty}`,
              },
            })
          }

          const variances = session.items.filter((i: any) => i.varianceQty !== 0 && i.varianceQty !== null)

          await tx.auditLog.create({
            data: {
              pharmacyId,
              userId,
              action: "APPROVE",
              entity: "StockAuditSession",
              entityId: id,
              newData: {
                sessionNumber: session.sessionNumber,
                totalItems: session.items.length,
                itemsWithVariance: variances.length,
                notes: data.notes,
              },
            },
          })

          return tx.stockAuditSession.update({
            where: { id },
            data: { status: "APPROVED", approvedAt: new Date(), approvedBy: userId },
          })
        },
        { isolationLevel: "Serializable", timeout: 20_000 },
      )
      .catch((err) => {
        if (err.code === "P2034") throw AppError.conflict("Concurrent modification — please retry")
        throw err
      })
  }

  async cancelSession(id: string, pharmacyId: string, userId: string) {
    const session = await this.db.stockAuditSession.findFirst({ where: { id, pharmacyId } })
    if (!session) throw AppError.notFound("Audit session not found")
    if (!["DRAFT", "IN_PROGRESS"].includes(session.status))
      throw AppError.conflict(`Cannot cancel a session in ${session.status} status`)

    await this.db.auditLog.create({
      data: {
        pharmacyId,
        userId,
        action: "DELETE",
        entity: "StockAuditSession",
        entityId: id,
        oldData: { sessionNumber: session.sessionNumber, status: session.status },
      },
    })

    return this.db.stockAuditSession.update({
      where: { id },
      data: { status: "CANCELLED" },
    })
  }

  async getSession(id: string, pharmacyId: string) {
    return this.db.stockAuditSession.findFirst({
      where: { id, pharmacyId },
      include: {
        items: {
          include: ITEM_INCLUDE,
          orderBy: { createdAt: "asc" },
        },
        _count: { select: { items: true } },
      },
    })
  }

  // Returns a dry-run summary of the inventory adjustments that would be applied
  // when this session is approved — no data is written.
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

    const adjustments = session.items.map((item: any) => ({
      inventoryId:  item.inventoryId,
      medicineName: item.inventory.medicine.name,
      batchNumber:  item.inventory.batchNumber,
      expiryDate:   item.inventory.expiryDate,
      currentQty:   item.inventory.quantity,
      expectedQty:  item.expectedQty,
      countedQty:   item.countedQty,
      varianceQty:  item.varianceQty,
      direction:    (item.varianceQty > 0 ? "IN" : "OUT") as "IN" | "OUT",
      resultQty:    Math.max(0, item.inventory.quantity + item.varianceQty),
    }))

    const totalIn  = adjustments.filter((a) => a.direction === "IN").reduce((s, a) => s + a.varianceQty, 0)
    const totalOut = adjustments.filter((a) => a.direction === "OUT").reduce((s, a) => s + Math.abs(a.varianceQty), 0)

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
        include: {
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.db.stockAuditSession.count({ where }),
    ])

    // Enrich with variance summary
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
