import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

// Append pool settings to the database URL so Prisma's query engine enforces
// the connection limit and pool timeout at the driver level rather than relying
// on Prisma's default per-process heuristic (min(2×cpu+1, 10)).
function buildDatasourceUrl(): string | undefined {
  const base    = process.env["DATABASE_URL"];
  if (!base) return undefined;

  const poolSize    = Number(process.env["DB_POOL_SIZE"]    ?? 10);
  const poolTimeout = Number(process.env["DB_POOL_TIMEOUT"] ?? 10);

  // Avoid double-appending if the URL already contains pool params
  if (base.includes("connection_limit")) return base;

  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}connection_limit=${poolSize}&pool_timeout=${poolTimeout}`;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env["NODE_ENV"] === "development"
      ? ["query", "error", "warn"]
      : ["error"],
    datasources: {
      db: { url: buildDatasourceUrl() },
    },
  });

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";
