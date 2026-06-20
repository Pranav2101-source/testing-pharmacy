export { boss }                    from "./boss.js";
export { enqueuePostInvoice }      from "./client.js";
export type { PostInvoiceJobData } from "./client.js";
export { setupScheduledJobs }      from "./scheduler.js";

import { boss }    from "./boss.js";
import { expiryAlertHandler }    from "./processors/expiry-alert.js";
import { lowStockAlertHandler }  from "./processors/low-stock-alert.js";
import { grnOverdueHandler }     from "./processors/grn-overdue.js";
import { eodSummaryHandler }     from "./processors/eod-summary.js";
import { quotationExpiryHandler } from "./processors/quotation-expiry.js";
import { pendingCreditHandler }  from "./processors/pending-credit.js";
import { calendarDigestHandler } from "./processors/calendar-digest.js";
import { postInvoiceHandler }    from "./processors/post-invoice.js";
import { reservationCleanupHandler } from "./processors/reservation-cleanup.js";

// Call once per process. Starts pg-boss (creates pgboss schema/tables on first
// run), then registers all job workers. pg-boss uses LISTEN/NOTIFY for delivery —
// no polling loop, no Redis, zero external service required.
export async function startWorkers(): Promise<void> {
  await boss.start();

  // Fan-out jobs: one worker handles all pharmacies in-process.
  // localConcurrency = max concurrent jobs fetched per poll; concurrency within each team.
  await Promise.all([
    boss.work("expiry-alerts",       { localConcurrency: 5 }, expiryAlertHandler),
    boss.work("low-stock-alerts",    { localConcurrency: 5 }, lowStockAlertHandler),
    boss.work("grn-overdue",         { localConcurrency: 5 }, grnOverdueHandler),
    boss.work("eod-summary",         { localConcurrency: 5 }, eodSummaryHandler),
    boss.work("quotation-expiry",    { localConcurrency: 5 }, quotationExpiryHandler),
    boss.work("pending-credit",      { localConcurrency: 5 }, pendingCreditHandler),
    boss.work("calendar-digest",     { localConcurrency: 5 }, calendarDigestHandler),
    // post-invoice is event-driven (triggered by billing), not cron; higher concurrency
    boss.work("post-invoice",        { localConcurrency: 10 }, postInvoiceHandler),
    // reservation-cleanup is single-threaded to avoid concurrent inventory mutations
    boss.work("reservation-cleanup", { localConcurrency: 1  }, reservationCleanupHandler),
  ]);

  console.info("[pg-boss] all workers registered");
}
