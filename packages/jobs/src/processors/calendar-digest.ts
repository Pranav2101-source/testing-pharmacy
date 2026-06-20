import type { Job } from "pg-boss";
import { prisma } from "@pharmacy/database";
import { inAppNotify } from "@pharmacy/mailer";

const DAY_MS = 24 * 60 * 60 * 1_000;

const EVENT_TYPE_LABELS: Record<string, string> = {
  EXPIRY_ALERT:    "Expiry Alert",
  CREDIT_DUE:      "Credit Due",
  PO_DELIVERY:     "PO Delivery",
  BILL_REMINDER:   "Bill Reminder",
  STOCK_AUDIT:     "Stock Audit",
  LICENSE_RENEWAL: "License Renewal",
  CUSTOM:          "Event",
};

async function processPharmacy(pharmacyId: string, pharmacyName: string): Promise<void> {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);

  const [manualEvents, expiringBatches, creditDue, poDeliveries] = await Promise.all([
    prisma.calendarEvent.findMany({
      where:   { pharmacyId, date: { gte: todayStart, lte: todayEnd }, isDone: false },
      select:  { title: true, type: true },
      orderBy: { date: "asc" },
    }),
    prisma.inventory.findMany({
      where:  { pharmacyId, status: "ACTIVE", expiryDate: { gte: todayStart, lte: todayEnd } },
      select: { medicine: { select: { name: true } }, batchNumber: true },
    }),
    prisma.invoice.findMany({
      where: {
        pharmacyId,
        paymentStatus: { in: ["PENDING", "PARTIAL"] },
        status:        "COMPLETED",
        createdAt:     {
          gte: new Date(todayStart.getTime() - 30 * DAY_MS),
          lte: new Date(todayEnd.getTime()   - 30 * DAY_MS),
        },
      },
      select: { customer: { select: { name: true } }, totalAmount: true },
    }),
    prisma.purchaseOrder.findMany({
      where: {
        pharmacyId,
        status:       { notIn: ["RECEIVED", "CANCELLED"] },
        expectedDate: { gte: todayStart, lte: todayEnd },
      },
      select: { supplier: { select: { name: true } } },
    }),
  ]);

  const lines: string[] = [];
  for (const ev of manualEvents)    lines.push(`• [${EVENT_TYPE_LABELS[ev.type] ?? ev.type}] ${ev.title}`);
  for (const b  of expiringBatches) lines.push(`• [Expiry] ${b.medicine.name} — batch ${b.batchNumber}`);
  for (const c  of creditDue)       lines.push(`• [Credit Due] ${c.customer?.name ?? "Walk-in"} (₹${c.totalAmount.toLocaleString("en-IN")})`);
  for (const p  of poDeliveries)    lines.push(`• [PO Delivery] ${p.supplier.name}`);

  if (lines.length === 0) return;

  const total   = lines.length;
  const preview = lines.slice(0, 3).join("\n");
  const more    = total > 3 ? `\n  …and ${total - 3} more` : "";

  await inAppNotify(prisma, pharmacyId, {
    subject: `📅 ${total} event${total !== 1 ? "s" : ""} today — ${pharmacyName}`,
    message: preview + more,
  });
}

export async function calendarDigestHandler(_jobs: Job[]): Promise<void> {
  const pharmacies = await prisma.pharmacy.findMany({
    where:  { isActive: true },
    select: { id: true, name: true },
  });

  const results = await Promise.allSettled(
    pharmacies.map((p) => processPharmacy(p.id, p.name)),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.warn(`[calendar-digest] ${failed.length}/${pharmacies.length} pharmacies failed`);
    for (const f of failed) {
      if (f.status === "rejected") console.error("[calendar-digest] error:", f.reason);
    }
  }
}
