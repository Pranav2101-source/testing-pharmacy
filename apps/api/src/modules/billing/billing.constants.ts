export const GST_RATES      = [0, 5, 12, 18] as const;
export type  GstRate        = (typeof GST_RATES)[number];

export const PAYMENT_MODES    = ["CASH", "UPI", "CARD", "CREDIT", "WALLET"] as const;
export const PAYMENT_STATUSES = ["PAID", "PENDING", "PARTIAL"] as const;
export const INVOICE_STATUSES = ["DRAFT", "COMPLETED", "CANCELLED", "RETURNED", "PARTIALLY_RETURNED"] as const;

// ── Invoice sequence helpers ──────────────────────────────────────────────────
//
// Indian GST mandates that invoice numbers restart from 1 every financial year
// (April 1 → March 31). The financial year is embedded in the Redis key so the
// counter resets automatically at the start of each new year.

function currentFinancialYear(): string {
  // Use IST (UTC+5:30) so the FY flips at April 1 00:00 IST, not April 1 00:00 UTC.
  // Without this, sequence keys would use the old FY until 05:30 IST on April 1.
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const now  = new Date(Date.now() + IST_OFFSET_MS);
  const year = now.getUTCFullYear();
  return now.getUTCMonth() >= 3
    ? `${year}-${year + 1}`    // Apr–Dec:  e.g. "2025-2026"
    : `${year - 1}-${year}`;   // Jan–Mar:  e.g. "2024-2025"
}

export const INVOICE_SEQUENCE_KEY = (pharmacyId: string) =>
  `invoice:seq:${pharmacyId}:${currentFinancialYear()}`;

export const RETURN_SEQUENCE_KEY  = (pharmacyId: string) =>
  `return:seq:${pharmacyId}:${currentFinancialYear()}`;

// ── Document sequence keys for other modules ──────────────────────────────────
// All keyed by financial year so counters reset every April 1.
// The Redis INCR pattern (same as invoices) is used instead of COUNT(*) to
// prevent the race condition where two concurrent creates both read the same
// count and generate duplicate document numbers.

export const PO_SEQUENCE_KEY  = (pharmacyId: string) => `po:seq:${pharmacyId}:${currentFinancialYear()}`;
export const GRN_SEQUENCE_KEY = (pharmacyId: string) => `grn:seq:${pharmacyId}:${currentFinancialYear()}`;
export const SR_SEQUENCE_KEY  = (pharmacyId: string) => `sr:seq:${pharmacyId}:${currentFinancialYear()}`;
export const QT_SEQUENCE_KEY  = (pharmacyId: string) => `qt:seq:${pharmacyId}:${currentFinancialYear()}`;

// Audit sessions use a daily key (IST date) so the three-digit suffix stays
// human-readable within a single day, matching the original AUDIT-YYYYMMDD-NNN format.
function istDateString(): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const d   = new Date(Date.now() + IST_OFFSET_MS);
  const y   = d.getUTCFullYear();
  const m   = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
export const AUDIT_SEQUENCE_KEY = (pharmacyId: string) => `audit:seq:${pharmacyId}:${istDateString()}`;

// ── Number formatters ─────────────────────────────────────────────────────────
// Keep a consistent "TYPE/FY/SEQ" format across all document types, matching
// the invoice format so accountants have a uniform numbering scheme.

function fyShort(): string {
  const [start, end] = currentFinancialYear().split("-");
  return `${start!.slice(-2)}-${end!.slice(-2)}`; // "25-26"
}

export const generatePONumber    = (seq: number) => `PO/${fyShort()}/${String(seq).padStart(5, "0")}`;
export const generateGRNNumber   = (seq: number) => `GRN/${fyShort()}/${String(seq).padStart(5, "0")}`;
export const generateSRNumber    = (seq: number) => `SR/${fyShort()}/${String(seq).padStart(5, "0")}`;
export const generateQTNumber    = (seq: number) => `QT/${fyShort()}/${String(seq).padStart(5, "0")}`;
export const generateAuditNumber = (seq: number) => `AUDIT-${istDateString()}-${String(seq).padStart(3, "0")}`;
