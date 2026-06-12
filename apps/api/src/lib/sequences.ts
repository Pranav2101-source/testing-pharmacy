import type { Db, DbTransactionClient } from "@pharmacy/database";

// ─── Postgres-backed document sequences ───────────────────────────────────────
// Replaces the previous Redis INCR counters. Redis can lose its counter value
// (restart without persistence, free-tier eviction), after which re-issued
// numbers collide with the unique (pharmacyId, number) constraints and every
// new document save fails with a 409. The DocumentSequence table makes the
// counter as durable as the documents themselves.
//
// When called with a transaction client, the increment commits/rolls back with
// the surrounding transaction — invoice numbering is therefore GAPLESS: a
// failed sale returns its number instead of burning it.
//
// Concurrency: the ON CONFLICT upsert serializes on the counter row. Under
// Serializable isolation a concurrent increment surfaces as P2034, which the
// billing error handler already maps to a retryable 409.

export type SequenceKind =
  | "INVOICE"
  | "SALES_RETURN"
  | "PURCHASE_ORDER"
  | "GRN"
  | "SUPPLIER_RETURN"
  | "QUOTATION"
  | "STOCK_AUDIT";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Indian financial-year period key, e.g. "2025-2026". Computed in IST so the
 * counter rolls over at April 1 00:00 IST, not 05:30 IST (the UTC boundary).
 * GST mandates invoice numbering restart each financial year.
 */
export function financialYearPeriod(): string {
  const now  = new Date(Date.now() + IST_OFFSET_MS);
  const year = now.getUTCFullYear();
  return now.getUTCMonth() >= 3
    ? `${year}-${year + 1}` // Apr–Dec
    : `${year - 1}-${year}`; // Jan–Mar
}

/** IST calendar-day period key, e.g. "20260612" — used by stock-audit numbering. */
export function istDayPeriod(): string {
  const d = new Date(Date.now() + IST_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Atomically advance and return the next value of a per-pharmacy document
 * counter. Pass the transaction client (`tx`) when the number must be gapless
 * (invoice/return); the plain client is fine where occasional gaps from a
 * failed create are acceptable (PO, GRN, quotations, ...).
 */
export async function nextSequenceValue(
  db:         Db | DbTransactionClient,
  pharmacyId: string,
  kind:       SequenceKind,
  period:     string = financialYearPeriod(),
): Promise<number> {
  const rows = await db.$queryRaw<Array<{ value: number }>>`
    INSERT INTO document_sequences ("pharmacyId", "kind", "period", "value", "updatedAt")
    VALUES (${pharmacyId}, ${kind}, ${period}, 1, NOW())
    ON CONFLICT ("pharmacyId", "kind", "period")
    DO UPDATE SET "value" = document_sequences."value" + 1, "updatedAt" = NOW()
    RETURNING "value"
  `;

  const value = rows[0]?.value;
  if (value === undefined) {
    // Unreachable in practice — INSERT ... RETURNING always yields a row.
    throw new Error(`Failed to advance ${kind} sequence for pharmacy ${pharmacyId}`);
  }
  return value;
}
