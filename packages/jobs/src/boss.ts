import PgBoss from "pg-boss";

// pg-boss uses LISTEN/NOTIFY which requires a persistent, direct connection.
// Supabase's Transaction pooler (DATABASE_URL, port 6543) does not support
// LISTEN/NOTIFY — always use the direct connection string (DIRECT_URL, port 5432).
function buildConnectionString(): string {
  const raw = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!raw) throw new Error("DIRECT_URL (or DATABASE_URL) is not set — pg-boss cannot start");
  try {
    const url = new URL(raw);
    url.searchParams.delete("connection_limit");
    url.searchParams.delete("pool_timeout");
    url.searchParams.delete("pgbouncer");
    return url.toString();
  } catch {
    return raw; // not a valid URL — pass as-is and let pg fail loudly
  }
}

// Single pg-boss instance shared across the process.
// Created eagerly (module load), started lazily (startWorkers).
// pg-boss uses PostgreSQL LISTEN/NOTIFY for job delivery — zero Redis requests.
export const boss = new PgBoss({
  connectionString: buildConnectionString(),

  // Isolated schema keeps pg-boss tables away from our application tables.
  schema: "pgboss",

  // Keep the connection pool small — Prisma already holds its own pool.
  // Two connections (one for polling, one for LISTEN) are enough for single-process.
  max: 2,

  // Archive completed jobs after 30 min; delete them from archive after 6 hours.
  // Keeps the pgboss.job table lean without losing recent job history.
  archiveCompletedAfterSeconds: 1_800,
  deleteAfterSeconds: 21_600,

  // Poll interval is a safety net; LISTEN/NOTIFY handles real-time delivery.
  // 60 s here means the absolute worst-case delay if NOTIFY is missed.
  newJobCheckIntervalSeconds: 60,

  // Stalled jobs: re-queue a job that has been active for > 5 minutes without
  // completing. Matches the old stalledInterval of 300_000 ms from BullMQ.
  monitorStateIntervalSeconds: 60,
});

boss.on("error", (err: Error) => {
  console.error("[pg-boss] internal error:", err.message);
});
