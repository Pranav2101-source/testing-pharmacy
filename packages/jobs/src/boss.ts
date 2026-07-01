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
    // sslmode=require in the connection string causes the pg driver to force verify-full
    // which overrides the ssl: { rejectUnauthorized: false } setting and causes SELF_SIGNED_CERT_IN_CHAIN.
    url.searchParams.delete("sslmode");
    return url.toString();
  } catch {
    return raw;
  }
}

function buildSslOptions(): any {
  const raw = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    // Localhost databases typically don't use SSL
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return undefined;
    }
    // Remote databases (like Supabase) require SSL, and rejectUnauthorized: false
    // is needed to bypass the SELF_SIGNED_CERT_IN_CHAIN error in Node's pg driver.
    return { rejectUnauthorized: false };
  } catch {
    return { rejectUnauthorized: false };
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

  // SSL configuration required for Supabase
  ssl: buildSslOptions(),
});

boss.on("error", (err: Error) => {
  console.error("[pg-boss] internal error:", err.message);
});
