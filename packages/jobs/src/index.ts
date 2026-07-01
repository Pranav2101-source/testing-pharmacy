export { boss }                       from "./boss.js";
export { enqueuePostInvoice, enqueueMigrationImport } from "./client.js";
export type { PostInvoiceJobData, MigrationImportJobData } from "./client.js";
export { setupScheduledJobs }      from "./scheduler.js";

import { boss }    from "./boss.js";
import { expiryAlertHandler }    from "./processors/expiry-alert.js";
import { lowStockAlertHandler }  from "./processors/low-stock-alert.js";
import { grnOverdueHandler }     from "./processors/grn-overdue.js";
import { eodSummaryHandler }     from "./processors/eod-summary.js";
import { quotationExpiryHandler } from "./processors/quotation-expiry.js";
import { pendingCreditHandler }  from "./processors/pending-credit.js";
import { calendarDigestHandler } from "./processors/calendar-digest.js";
import { postInvoiceHandler }      from "./processors/post-invoice.js";
import { reservationCleanupHandler } from "./processors/reservation-cleanup.js";
import { migrationImportHandler }  from "./processors/migration-import.js";
import { auditWorkerHandler }      from "./processors/audit-worker.js";

// Call once per process. Starts pg-boss (creates pgboss schema/tables on first
// run), then registers all job workers. pg-boss uses LISTEN/NOTIFY for delivery —
// no polling loop, no Redis, zero external service required.
export async function startWorkers(): Promise<void> {
  await boss.start();

  // pg-boss v9+ requires queues to exist before workers can attach.
  // createQueue() is idempotent — safe to call on every startup.
  // Scheduled queues (expiry-alerts, etc.) are created by boss.schedule() in
  // setupScheduledJobs, but event-driven queues must be created explicitly here.
  await Promise.all([
    boss.createQueue("post-invoice"),
    boss.createQueue("reservation-cleanup"),
    boss.createQueue("migration-import"),
    boss.createQueue("audit-log"),
  ]);
  const queues = [
    "expiry-alerts",
    "low-stock-alerts",
    "grn-overdue",
    "quotation-expiry",
    "eod-summary",
    "pending-credit",
    "calendar-digest",
    "reservation-cleanup",
    "post-invoice",
    "audit-log",
  ];

  await Promise.all(queues.map((q) => boss.createQueue(q)));

  // Fan-out jobs: one worker handles all pharmacies in-process.
  // localConcurrency = max concurrent jobs fetched per poll; concurrency within each team.
  //
  // pollingIntervalSeconds tunes how often each worker SELECTs the queue for new
  // jobs. pg-boss defaults to 2s per worker — with 10 workers that's ~5 polls/sec
  // (millions of trivial queries/day) for no benefit, since the cron-dispatched
  // jobs below run at most hourly. They poll at 60s (pickup lag is invisible vs a
  // daily/hourly schedule). Only the event-driven, user-facing queues stay fast:
  // post-invoice (post-sale processing) at 5s, migration-import (onboarding shows
  // live progress) at the 2s default.
  const CRON_POLL = 60; // seconds — for boss.schedule()-dispatched workers
  await Promise.all([
    boss.work("expiry-alerts",       { localConcurrency: 5, pollingIntervalSeconds: CRON_POLL }, expiryAlertHandler),
    boss.work("low-stock-alerts",    { localConcurrency: 5, pollingIntervalSeconds: CRON_POLL }, lowStockAlertHandler),
    boss.work("grn-overdue",         { localConcurrency: 5, pollingIntervalSeconds: CRON_POLL }, grnOverdueHandler),
    boss.work("eod-summary",         { localConcurrency: 5, pollingIntervalSeconds: CRON_POLL }, eodSummaryHandler),
    boss.work("quotation-expiry",    { localConcurrency: 5, pollingIntervalSeconds: CRON_POLL }, quotationExpiryHandler),
    boss.work("pending-credit",      { localConcurrency: 5, pollingIntervalSeconds: CRON_POLL }, pendingCreditHandler),
    boss.work("calendar-digest",     { localConcurrency: 5, pollingIntervalSeconds: CRON_POLL }, calendarDigestHandler),
    boss.work("reservation-cleanup", { localConcurrency: 1, pollingIntervalSeconds: CRON_POLL }, reservationCleanupHandler),
    boss.work("post-invoice",        { localConcurrency: 10, pollingIntervalSeconds: 5 }, postInvoiceHandler),
    boss.work("migration-import",    { localConcurrency: 2  }, migrationImportHandler),
    boss.work("audit-log",           { localConcurrency: 10 }, auditWorkerHandler),
  ]);

  console.info("[pg-boss] all workers registered");
}
