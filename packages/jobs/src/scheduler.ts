import { boss } from "./boss.js";

// All cron patterns are UTC. IST = UTC+5:30.
// pg-boss schedule() is idempotent: re-registering an unchanged schedule on
// restart is a no-op; changing the cron updates the stored schedule in-place.
const SCHEDULES = [
  { name: "expiry-alerts",       cron: "30 1 * * *",  desc: "Daily expiry alert (7:00 AM IST)" },
  { name: "low-stock-alerts",    cron: "35 1 * * *",  desc: "Daily low-stock alert (7:05 AM IST)" },
  { name: "grn-overdue",         cron: "30 2 * * *",  desc: "Daily GRN overdue check (8:00 AM IST)" },
  { name: "quotation-expiry",    cron: "35 2 * * *",  desc: "Daily quotation-expiry check (8:05 AM IST)" },
  { name: "eod-summary",         cron: "30 15 * * *", desc: "Daily end-of-day summary (9:00 PM IST)" },
  { name: "pending-credit",      cron: "30 3 * * 1",  desc: "Weekly pending-credit digest (Monday 9:00 AM IST)" },
  { name: "calendar-digest",     cron: "30 2 * * *",  desc: "Daily calendar digest (8:00 AM IST)" },
  { name: "reservation-cleanup", cron: "0 * * * *",   desc: "Hourly expired-reservation cleanup" },
] as const;

export async function setupScheduledJobs(): Promise<void> {
  await Promise.all(
    SCHEDULES.map(async (s) => {
      await boss.schedule(s.name, s.cron, {});
      console.info(`[scheduler] registered: ${s.desc}`);
    }),
  );
}
