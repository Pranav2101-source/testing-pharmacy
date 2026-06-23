import { PgBoss } from "pg-boss";

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
    // sslmode=require in the connection string causes the pg driver to force verify-full
    // which overrides the ssl: { rejectUnauthorized: false } setting and causes SELF_SIGNED_CERT_IN_CHAIN.
    url.searchParams.delete("sslmode");
    return url.toString();
  } catch {
    return raw; // not a valid URL — pass as-is and let pg fail loudly
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
