/**
 * India Standard Time, as a fixed offset. India has no DST and has not changed
 * offset since 1945, so a literal beats a tz database lookup here.
 */
const IST_OFFSET = "+05:30";

/**
 * Convert a `<input type="date">` value (`YYYY-MM-DD`) into the ISO-8601 instant
 * marking the START of that day in IST — the lower bound of a date-range filter.
 *
 * <p>Anchoring to IST rather than the browser's zone is deliberate: the pharmacy's
 * business day is IST no matter where the person viewing the list happens to be, and
 * the backend computes its own day boundaries in IST too (BillingService.IST). A
 * device with a mis-set timezone would otherwise silently shift which bills appear.
 *
 * <p>The explicit time is what makes this correct. `new Date("2026-04-01")` parses a
 * bare date as UTC midnight per the ECMAScript spec, while `new Date("2026-04-01T00:00:00")`
 * parses as LOCAL midnight — so pairing a bare `from` with a timed `to` silently drops
 * every row recorded before 05:30 IST on the start date, and the only symptom is a
 * slightly shorter list with nothing to indicate anything was excluded.
 *
 * @returns the ISO instant, or null if the input is empty or unparseable
 */
export function istRangeStart(dateStr: string): string | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00${IST_OFFSET}`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The END of the given day in IST (inclusive, to millisecond precision) — the upper
 * bound of a date-range filter. See {@link istRangeStart} for why IST and why the
 * time component is explicit.
 *
 * @returns the ISO instant, or null if the input is empty or unparseable
 */
export function istRangeEnd(dateStr: string): string | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T23:59:59.999${IST_OFFSET}`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Build the `{ from, to }` query params for a date-range filter, omitting either
 * bound that is empty or unparseable rather than sending `"Invalid Date"` (or
 * throwing — `new Date("").toISOString()` raises RangeError).
 */
export function istRangeParams(fromStr: string, toStr: string): { from?: string; to?: string } {
  const from = istRangeStart(fromStr);
  const to = istRangeEnd(toStr);
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

export function formatDate(date: Date | string, format = "DD/MM/YYYY"): string {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return format
    .replace("DD", day)
    .replace("MM", month)
    .replace("YYYY", String(year));
}

export function isExpired(expiryDate: Date | string): boolean {
  return new Date(expiryDate) < new Date();
}

export function isNearExpiry(
  expiryDate: Date | string,
  daysThreshold = 90
): boolean {
  const expiry = new Date(expiryDate);
  const threshold = new Date();
  threshold.setDate(threshold.getDate() + daysThreshold);
  return expiry <= threshold && expiry >= new Date();
}
