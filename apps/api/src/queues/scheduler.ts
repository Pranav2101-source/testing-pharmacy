import {
  expiryAlertQueue,
  lowStockAlertQueue,
  grnOverdueQueue,
  eodSummaryQueue,
  quotationExpiryQueue,
  pendingCreditQueue,
  calendarDigestQueue,
} from "./queue.client.js";

// All times are UTC. India Standard Time = UTC+5:30.
// Each entry: { queue, jobId, cron (UTC), description }

const SCHEDULES = [
  {
    queue:       expiryAlertQueue,
    jobId:       "sched:expiry-alert",
    // 7:00 AM IST = 01:30 UTC daily
    cron:        "30 1 * * *",
    description: "Daily expiry alert (7:00 AM IST)",
  },
  {
    queue:       lowStockAlertQueue,
    jobId:       "sched:low-stock",
    // 7:05 AM IST = 01:35 UTC daily
    cron:        "35 1 * * *",
    description: "Daily low-stock alert (7:05 AM IST)",
  },
  {
    queue:       grnOverdueQueue,
    jobId:       "sched:grn-overdue",
    // 8:00 AM IST = 02:30 UTC daily
    cron:        "30 2 * * *",
    description: "Daily GRN overdue check (8:00 AM IST)",
  },
  {
    queue:       quotationExpiryQueue,
    jobId:       "sched:quotation-expiry",
    // 8:05 AM IST = 02:35 UTC daily
    cron:        "35 2 * * *",
    description: "Daily quotation-expiry check (8:05 AM IST)",
  },
  {
    queue:       eodSummaryQueue,
    jobId:       "sched:eod-summary",
    // 9:00 PM IST = 15:30 UTC daily
    cron:        "30 15 * * *",
    description: "Daily end-of-day summary (9:00 PM IST)",
  },
  {
    queue:       pendingCreditQueue,
    jobId:       "sched:pending-credit",
    // Every Monday 9:00 AM IST = Monday 03:30 UTC
    cron:        "30 3 * * 1",
    description: "Weekly pending-credit digest (Monday 9:00 AM IST)",
  },
  {
    queue:       calendarDigestQueue,
    jobId:       "sched:calendar-digest",
    // 8:00 AM IST = 02:30 UTC daily
    cron:        "30 2 * * *",
    description: "Daily calendar digest (8:00 AM IST)",
  },
] as const;

export async function setupScheduledJobs(): Promise<void> {
  for (const sched of SCHEDULES) {
    // Remove stale job (if cron pattern changed) then re-add idempotently
    const existing = await sched.queue.getRepeatableJobs();
    const stale    = existing.filter((j) => j.id === sched.jobId && j.pattern !== sched.cron);
    for (const s of stale) {
      await sched.queue.removeRepeatableByKey(s.key);
    }

    // Add the repeatable job (BullMQ deduplicates by name+pattern)
    await sched.queue.add(
      sched.jobId,
      {},
      {
        repeat:           { pattern: sched.cron },
        removeOnComplete: { count: 5 },
        removeOnFail:     { count: 10 },
        jobId:            sched.jobId,
      },
    );

    console.log(`[scheduler] registered: ${sched.description}`);
  }
}
