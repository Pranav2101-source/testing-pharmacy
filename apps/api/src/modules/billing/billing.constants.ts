import { financialYearPeriod, istDayPeriod } from "../../lib/sequences.js";

export const GST_RATES      = [0, 5, 12, 18] as const;
export type  GstRate        = (typeof GST_RATES)[number];

export const PAYMENT_MODES    = ["CASH", "UPI", "CARD", "CREDIT", "WALLET"] as const;
export const PAYMENT_STATUSES = ["PAID", "PENDING", "PARTIAL"] as const;
export const INVOICE_STATUSES = ["DRAFT", "COMPLETED", "CANCELLED", "RETURNED", "PARTIALLY_RETURNED"] as const;

// ── Document number formatters ────────────────────────────────────────────────
// Sequence VALUES come from the document_sequences Postgres table (see
// lib/sequences.ts) — durable, transactional, race-safe. The previous Redis
// INCR counters lost their value on Redis restarts/eviction and then produced
// numbers colliding with the unique (pharmacyId, number) constraints.
// Indian GST mandates numbering restarts each financial year (April 1, IST);
// the reset is handled by the `period` column of the counter table.
//
// Formats stay consistent ("TYPE/FY/SEQ") across all document types so
// accountants see a uniform numbering scheme.

function fyShort(): string {
  const [start, end] = financialYearPeriod().split("-");
  return `${start!.slice(-2)}-${end!.slice(-2)}`; // "25-26"
}

export const generatePONumber    = (seq: number) => `PO/${fyShort()}/${String(seq).padStart(5, "0")}`;
export const generateGRNNumber   = (seq: number) => `GRN/${fyShort()}/${String(seq).padStart(5, "0")}`;
export const generateSRNumber    = (seq: number) => `SR/${fyShort()}/${String(seq).padStart(5, "0")}`;
export const generateQTNumber    = (seq: number) => `QT/${fyShort()}/${String(seq).padStart(5, "0")}`;
export const generateAuditNumber = (seq: number) => `AUDIT-${istDayPeriod()}-${String(seq).padStart(3, "0")}`;
