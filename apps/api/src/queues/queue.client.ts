import { Queue } from "bullmq";
import { env } from "../config/env.js";

const connection = { url: env.REDIS_URL };

// ─── Existing queues ──────────────────────────────────────────────────────────
export const notificationQueue = new Queue("notifications",   { connection });
export const reportQueue        = new Queue("reports",         { connection });
export const expiryAlertQueue   = new Queue("expiry-alerts",   { connection });

// ─── Scheduled notification queues ───────────────────────────────────────────
export const lowStockAlertQueue    = new Queue("low-stock-alerts",    { connection });
export const grnOverdueQueue       = new Queue("grn-overdue",          { connection });
export const eodSummaryQueue       = new Queue("eod-summary",          { connection });
export const quotationExpiryQueue  = new Queue("quotation-expiry",     { connection });
export const pendingCreditQueue    = new Queue("pending-credit-digest", { connection });
export const calendarDigestQueue   = new Queue("calendar-digest",        { connection });

export { connection };
