import type { FastifyInstance } from "fastify";
import { CalendarRepo } from "./calendar.repo.js";
import { AppError } from "../../lib/AppError.js";
import { inAppNotify } from "../../lib/notifications.js";
import { EVENT_TYPE_LABELS } from "./calendar.schema.js";
import type {
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
  CalendarQuery,
  CalendarEventDTO,
} from "./calendar.schema.js";

export class CalendarService {
  private repo: CalendarRepo;

  constructor(private app: FastifyInstance) {
    this.repo = new CalendarRepo(app.prisma);
  }

  // ── Get all events (manual + auto-derived) for a date range ────────────────
  async getEvents(pharmacyId: string, query: CalendarQuery): Promise<CalendarEventDTO[]> {
    const now = new Date();
    // Default: full current month ± 1 month buffer
    const from = query.from ? new Date(query.from) : new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to   = query.to   ? new Date(query.to)   : new Date(now.getFullYear(), now.getMonth() + 2, 0);

    const [manualEvents, expiringBatches, pendingInvoices, pendingPOs] = await Promise.all([
      this.repo.listManualEvents(pharmacyId, from, to),
      this.repo.getExpiringBatches(pharmacyId, from, to),
      this.repo.getPendingInvoices(pharmacyId, from, to),
      this.repo.getPendingPOs(pharmacyId, from, to),
    ]);

    const events: CalendarEventDTO[] = [
      // ── Manual events ──────────────────────────────────────────────────────
      ...manualEvents.map((e): CalendarEventDTO => ({
        id:          e.id,
        title:       e.title,
        description: e.description,
        date:        e.date.toISOString(),
        endDate:     e.endDate?.toISOString() ?? null,
        allDay:      e.allDay,
        type:        e.type as CalendarEventDTO["type"],
        color:       e.color,
        relatedId:   e.relatedId,
        relatedType: e.relatedType,
        isDone:      e.isDone,
        isAutomatic: false,
        createdAt:   e.createdAt.toISOString(),
      })),

      // ── Expiry alerts ──────────────────────────────────────────────────────
      ...expiringBatches.map((inv): CalendarEventDTO => {
        const daysLeft = Math.ceil(
          (inv.expiryDate.getTime() - Date.now()) / 86400000
        );
        return {
          id:          `auto-expiry-${inv.id}`,
          title:       `${inv.medicine.name} — batch ${inv.batchNumber} expires`,
          description: `${inv.quantity} units · ${daysLeft <= 0 ? "Expired" : `${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining`}`,
          date:        inv.expiryDate.toISOString(),
          endDate:     null,
          allDay:      true,
          type:        "EXPIRY_ALERT",
          color:       null,
          relatedId:   inv.id,
          relatedType: "inventory",
          isDone:      false,
          isAutomatic: true,
          createdAt:   null,
        };
      }),

      // ── Credit due ─────────────────────────────────────────────────────────
      ...pendingInvoices.map((inv): CalendarEventDTO => {
        const dueDate = new Date(inv.createdAt.getTime() + 30 * 86400000);
        const amtStr  = `₹${inv.totalAmount.toLocaleString("en-IN")}`;
        return {
          id:          `auto-credit-${inv.id}`,
          title:       `Credit due — ${inv.customer?.name ?? "Walk-in"} (${amtStr})`,
          description: `Invoice ${inv.invoiceNumber} · ${inv.paymentStatus}`,
          date:        dueDate.toISOString(),
          endDate:     null,
          allDay:      true,
          type:        "CREDIT_DUE",
          color:       null,
          relatedId:   inv.id,
          relatedType: "invoice",
          isDone:      false,
          isAutomatic: true,
          createdAt:   null,
        };
      }),

      // ── PO deliveries ──────────────────────────────────────────────────────
      ...pendingPOs
        .filter((po) => po.expectedDate != null)
        .map((po): CalendarEventDTO => ({
          id:          `auto-po-${po.id}`,
          title:       `Delivery expected — ${po.supplier.name}`,
          description: `PO ${po.orderNumber} · ${po.status}`,
          date:        po.expectedDate!.toISOString(),
          endDate:     null,
          allDay:      true,
          type:        "PO_DELIVERY",
          color:       null,
          relatedId:   po.id,
          relatedType: "purchase_order",
          isDone:      false,
          isAutomatic: true,
          createdAt:   null,
        })),
    ];

    // Sort chronologically
    return events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  // ── Today count (nav badge) ────────────────────────────────────────────────
  async getTodayCount(pharmacyId: string): Promise<number> {
    const [manual, expiring] = await Promise.all([
      this.repo.countTodayManualEvents(pharmacyId),
      this.repo.countTodayExpiringBatches(pharmacyId),
    ]);
    return manual + expiring;
  }

  // ── Create manual event ───────────────────────────────────────────────────
  async createEvent(pharmacyId: string, userId: string, input: CreateCalendarEventInput) {
    const event = await this.repo.createEvent(pharmacyId, userId, input);

    // Fire in-app notification — best-effort, non-blocking
    const typeLabel  = EVENT_TYPE_LABELS[input.type] ?? input.type;
    const eventDate  = new Date(input.date);
    const dateStr    = eventDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    inAppNotify(this.app.prisma, pharmacyId, {
      subject: `📅 ${typeLabel}: ${input.title}`,
      message: `Scheduled for ${dateStr}${input.description ? ` — ${input.description}` : ""}`,
    }).catch(() => {});

    return event;
  }

  // ── Update manual event ───────────────────────────────────────────────────
  async updateEvent(id: string, pharmacyId: string, input: UpdateCalendarEventInput) {
    const existing = await this.repo.findEvent(id, pharmacyId);
    if (!existing) throw AppError.notFound("Calendar event not found");
    return this.repo.updateEvent(id, pharmacyId, input);
  }

  // ── Delete manual event ───────────────────────────────────────────────────
  async deleteEvent(id: string, pharmacyId: string) {
    const existing = await this.repo.findEvent(id, pharmacyId);
    if (!existing) throw AppError.notFound("Calendar event not found");
    return this.repo.deleteEvent(id, pharmacyId);
  }
}
