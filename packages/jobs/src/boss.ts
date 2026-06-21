import { PgBoss } from "pg-boss";

// pg-boss uses LISTEN/NOTIFY which requires session mode — the transaction pooler
// (DATABASE_URL, port 6543) does not support it. Use PGBOSS_URL which points to
// Supabase's session mode pooler (same pooler host, port 5432). The true direct
// connection (DIRECT_URL, db.xxx.supabase.co:5432) is often blocked by ISP
// firewalls, so we avoid it here.
function buildConnectionString(): string {
  const raw = process.env.PGBOSS_URL ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!raw) throw new Error("PGBOSS_URL (or DATABASE_URL) is not set — pg-boss cannot start");
  try {
    const url = new URL(raw);
    url.searchParams.delete("connection_limit");
    url.searchParams.delete("pool_timeout");
    url.searchParams.delete("pgbouncer");
    return url.toString();
  } catch {
    return raw;
  }
}

// Single pg-boss instance shared across the process.
// Created eagerly (module load), started lazily (startWorkers).
export const boss = new PgBoss({
  connectionString: buildConnectionString(),

  // Isolated schema keeps pg-boss tables away from our application tables.
  schema: "pgboss",

  // Keep the connection pool small — Prisma already holds its own pool.
  max: 2,

  // Maintenance interval — checks for stalled/expired jobs.
  monitorIntervalSeconds: 60,
});

boss.on("error", (err: Error) => {
  console.error("[pg-boss] internal error:", err.message);
});
