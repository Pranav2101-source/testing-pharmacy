import type { Db } from "@pharmacy/database";
import type { CreateCalendarEventInput, UpdateCalendarEventInput } from "./calendar.schema.js";

export class CalendarRepo {
  constructor(private db: Db) {}

  // ── Manual events (DB-stored) ─────────────────────────────────────────────

  async listManualEvents(pharmacyId: string, from: Date, to: Date) {
    return this.db.calendarEvent.findMany({
      where: { pharmacyId, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
      select: {
        id: true, title: true, description: true,
        date: true, endDate: true, allDay: true,
        type: true, color: true, relatedId: true,
        relatedType: true, isDone: true, createdAt: true,
      },
    });
  }

  async createEvent(pharmacyId: string, createdById: string, input: CreateCalendarEventInput) {
    return this.db.calendarEvent.create({
      data: {
        pharmacyId,
        createdById,
        title:       input.title,
        description: input.description,
        date:        new Date(input.date),
        endDate:     input.endDate ? new Date(input.endDate) : null,
        allDay:      input.allDay,
        type:        input.type,
        color:       input.color,
        relatedId:   input.relatedId,
        relatedType: input.relatedType,
      },
    });
  }

  async updateEvent(id: string, pharmacyId: string, input: UpdateCalendarEventInput) {
    return this.db.calendarEvent.update({
      where: { id, pharmacyId },
      data: {
        ...(input.title       !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.date        !== undefined && { date: new Date(input.date) }),
        ...(input.endDate     !== undefined && { endDate: new Date(input.endDate) }),
        ...(input.allDay      !== undefined && { allDay: input.allDay }),
        ...(input.isDone      !== undefined && { isDone: input.isDone }),
        ...(input.color       !== undefined && { color: input.color }),
      },
    });
  }

  async deleteEvent(id: string, pharmacyId: string) {
    return this.db.calendarEvent.delete({ where: { id, pharmacyId } });
  }

  async findEvent(id: string, pharmacyId: string) {
    return this.db.calendarEvent.findFirst({ where: { id, pharmacyId } });
  }

  // ── Auto-derived event sources ────────────────────────────────────────────

  async getExpiringBatches(pharmacyId: string, from: Date, to: Date) {
    return this.db.inventory.findMany({
      where: {
        pharmacyId,
        status:     "ACTIVE",
        expiryDate: { gte: from, lte: to },
      },
      select: {
        id:         true,
        expiryDate: true,
        quantity:   true,
        batchNumber:true,
        medicine:   { select: { id: true, name: true, genericName: true } },
      },
      orderBy: { expiryDate: "asc" },
    });
  }

  async getPendingInvoices(pharmacyId: string, from: Date, to: Date) {
    return this.db.invoice.findMany({
      where: {
        pharmacyId,
        paymentStatus: { in: ["PENDING", "PARTIAL"] },
        status:        "COMPLETED",
        // treat credit due date as createdAt + 30 days; filter those falling in range
        createdAt: {
          gte: new Date(from.getTime() - 30 * 86400000),
          lte: new Date(to.getTime()  - 30 * 86400000),
        },
      },
      select: {
        id:            true,
        invoiceNumber: true,
        createdAt:     true,
        totalAmount:   true,
        paymentStatus: true,
        customer:      { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async getPendingPOs(pharmacyId: string, from: Date, to: Date) {
    return this.db.purchaseOrder.findMany({
      where: {
        pharmacyId,
        status:      { notIn: ["RECEIVED", "CANCELLED"] },
        expectedDate: { gte: from, lte: to },
      },
      select: {
        id:           true,
        orderNumber:  true,
        expectedDate: true,
        status:       true,
        supplier:     { select: { id: true, name: true } },
      },
      orderBy: { expectedDate: "asc" },
    });
  }

  // ── Today count (for nav badge) ───────────────────────────────────────────

  async countTodayManualEvents(pharmacyId: string) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end   = new Date(); end.setHours(23, 59, 59, 999);
    return this.db.calendarEvent.count({
      where: { pharmacyId, date: { gte: start, lte: end } },
    });
  }

  async countTodayExpiringBatches(pharmacyId: string) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end   = new Date(); end.setHours(23, 59, 59, 999);
    return this.db.inventory.count({
      where: { pharmacyId, status: "ACTIVE", expiryDate: { gte: start, lte: end } },
    });
  }
}
