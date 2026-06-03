import { Worker } from "bullmq";
import { prisma } from "@pharmacy/database";
import { connection } from "../queue.client.js";
import { inAppNotify } from "../../lib/notifications.js";
import { EVENT_TYPE_LABELS } from "../../modules/calendar/calendar.schema.js";

// ─────────────────────────────────────────────────────────────────────────────
// Calendar Digest — fires once daily (8:00 AM IST).
// For each active pharmacy, finds today's manual calendar events AND
// auto-derived events (expiring batches, credit due, PO deliveries)
// and fires a single aggregated IN_APP notification.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

new Worker(
  "calendar-digest",
  async () => {
    const pharmacies = await prisma.pharmacy.findMany({
      where:  { isActive: true },
      select: { id: true, name: true },
    });

    for (const pharmacy of pharmacies) {
      await processPharmacy(pharmacy.id, pharmacy.name);
    }
  },
  { connection, concurrency: 1 },
);

async function processPharmacy(pharmacyId: string, pharmacyName: string): Promise<void> {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);

  // ── 1. Manual calendar events for today ───────────────────────────────────
  const manualEvents = await prisma.calendarEvent.findMany({
    where: {
      pharmacyId,
      date:   { gte: todayStart, lte: todayEnd },
      isDone: false,
    },
    select: { title: true, type: true },
    orderBy: { date: "asc" },
  });

  // ── 2. Batches expiring today ──────────────────────────────────────────────
  const expiringBatches = await prisma.inventory.findMany({
    where: {
      pharmacyId,
      status:     "ACTIVE",
      expiryDate: { gte: todayStart, lte: todayEnd },
    },
    select: { medicine: { select: { name: true } }, batchNumber: true },
  });

  // ── 3. Credit invoices due today (created 30 days ago + PENDING) ──────────
  const creditCutStart = new Date(todayStart.getTime() - 30 * DAY_MS);
  const creditCutEnd   = new Date(todayEnd.getTime()   - 30 * DAY_MS);
  const creditDue = await prisma.invoice.findMany({
    where: {
      pharmacyId,
      paymentStatus: { in: ["PENDING", "PARTIAL"] },
      status:        "COMPLETED",
      createdAt:     { gte: creditCutStart, lte: creditCutEnd },
    },
    select: { customer: { select: { name: true } }, totalAmount: true },
  });

  // ── 4. PO deliveries expected today ───────────────────────────────────────
  const poDeliveries = await prisma.purchaseOrder.findMany({
    where: {
      pharmacyId,
      status:      { notIn: ["RECEIVED", "CANCELLED"] },
      expectedDate: { gte: todayStart, lte: todayEnd },
    },
    select: { supplier: { select: { name: true } } },
  });

  // ── Build summary lines ────────────────────────────────────────────────────
  const lines: string[] = [];

  for (const ev of manualEvents) {
    const label = EVENT_TYPE_LABELS[ev.type] ?? ev.type;
    lines.push(`• [${label}] ${ev.title}`);
  }
  for (const b of expiringBatches) {
    lines.push(`• [Expiry] ${b.medicine.name} — batch ${b.batchNumber}`);
  }
  for (const c of creditDue) {
    const name = c.customer?.name ?? "Walk-in";
    const amt  = `₹${c.totalAmount.toLocaleString("en-IN")}`;
    lines.push(`• [Credit Due] ${name} (${amt})`);
  }
  for (const p of poDeliveries) {
    lines.push(`• [PO Delivery] ${p.supplier.name}`);
  }

  if (lines.length === 0) return; // nothing today — skip notification

  const total = lines.length;
  const preview = lines.slice(0, 3).join("\n");
  const more    = total > 3 ? `\n  …and ${total - 3} more` : "";

  await inAppNotify(prisma, pharmacyId, {
    subject: `📅 ${total} event${total !== 1 ? "s" : ""} today — ${pharmacyName}`,
    message: preview + more,
  });
}
