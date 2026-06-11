import { Queue } from "bullmq";
import { env } from "../config/env.js";

// maxRetriesPerRequest: null is required by BullMQ — without it ioredis hard-closes
// the connection after a few failures (e.g. Upstash rate-limit) and the next in-flight
// command throws an unhandled "Connection is closed" rejection that kills the process.
const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null as null };

function makeQueue(name: string): Queue {
  const q = new Queue(name, { connection });
  // Attach an error listener so Queue-level Redis errors don't surface as
  // unhandled EventEmitter 'error' events (which crash Node.js).
  q.on("error", (err: Error) => {
    console.error(`[BullMQ] Queue "${name}" error: ${err.message}`);
  });
  return q;
}

// ─── Existing queues ──────────────────────────────────────────────────────────
export const notificationQueue = makeQueue("notifications");
export const reportQueue        = makeQueue("reports");
export const expiryAlertQueue   = makeQueue("expiry-alerts");

// Post-invoice: customer receipt email + credit-limit warnings.
// Runs asynchronously so the billing endpoint isn't blocked by SMTP latency.
export const postInvoiceQueue = makeQueue("post-invoice");

// ─── Scheduled notification queues ───────────────────────────────────────────
export const lowStockAlertQueue    = makeQueue("low-stock-alerts");
export const grnOverdueQueue       = makeQueue("grn-overdue");
export const eodSummaryQueue       = makeQueue("eod-summary");
export const quotationExpiryQueue  = makeQueue("quotation-expiry");
export const pendingCreditQueue    = makeQueue("pending-credit-digest");
export const calendarDigestQueue   = makeQueue("calendar-digest");
export const reservationCleanupQueue = makeQueue("reservation-cleanup");

export { connection };
