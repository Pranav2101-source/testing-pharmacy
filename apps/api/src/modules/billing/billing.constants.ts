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
  const now  = new Date();
  const year = now.getFullYear();
  // April (month 3 in 0-indexed) starts a new FY
  return now.getMonth() >= 3
    ? `${year}-${year + 1}`    // Apr–Dec:  e.g. "2025-2026"
    : `${year - 1}-${year}`;   // Jan–Mar:  e.g. "2024-2025"
}

export const INVOICE_SEQUENCE_KEY = (pharmacyId: string) =>
  `invoice:seq:${pharmacyId}:${currentFinancialYear()}`;

export const RETURN_SEQUENCE_KEY  = (pharmacyId: string) =>
  `return:seq:${pharmacyId}:${currentFinancialYear()}`;
