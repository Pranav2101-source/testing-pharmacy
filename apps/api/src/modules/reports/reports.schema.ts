import { z } from "zod";
import { AppError } from "../../lib/AppError.js";

// ── Query validation ──────────────────────────────────────────────────────────
// Without these, `new Date("garbage")` produces Invalid Date, which Prisma treats
// as matching nothing — reports silently return zeros instead of a 400. And
// `parseInt("abc")` produces NaN, which crashes Prisma's `take`.

export const dateString = z
  .string()
  .refine((s) => !Number.isNaN(new Date(s).getTime()), { message: "Invalid date — use YYYY-MM-DD or ISO format" });

const periodQuerySchema = z.object({ from: dateString, to: dateString });

const MAX_PERIOD_DAYS = 731; // 2 years — guards against accidental full-history scans

export interface ReportPeriod {
  from:    Date;
  to:      Date;
  fromRaw: string;
  toRaw:   string;
}

/**
 * Parse and validate a from/to reporting period. Plain `to` dates (no time
 * component) are extended to end-of-day so the last selected day is included.
 */
export function parsePeriod(query: unknown): ReportPeriod {
  const parsed = periodQuerySchema.parse(query);
  const from = new Date(parsed.from);
  const to   = new Date(parsed.to);
  if (!parsed.to.includes("T")) to.setUTCHours(23, 59, 59, 999);

  if (from > to) throw AppError.badRequest("'from' date must be before 'to' date");
  if (to.getTime() - from.getTime() > MAX_PERIOD_DAYS * 86_400_000) {
    throw AppError.badRequest(`Reporting period cannot exceed ${MAX_PERIOD_DAYS} days`);
  }
  return { from, to, fromRaw: parsed.from, toRaw: parsed.to };
}

// ── Per-endpoint query schemas ───────────────────────────────────────────────

export const dailySalesQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD").optional(),
});

export const expiryQuerySchema = z.object({
  days:  z.coerce.number().int().min(1).max(365).default(90),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export const costAnalysisQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const scheduleHQuerySchema = z.object({
  schedule: z.enum(["H", "H1", "X", "G", "h", "h1", "x", "g"]).optional(),
});

export const fastMovingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const slowMovingQuerySchema = z.object({
  limit:  z.coerce.number().int().min(1).max(50).default(20),
  minQty: z.coerce.number().int().min(0).default(1),
});

export const deadStockQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(3650).default(90),
});

export const valuationQuerySchema = z.object({
  groupBy: z.enum(["medicine", "category"]).default("medicine"),
});
