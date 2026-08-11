/**
 * India Standard Time, as a fixed offset. India has no DST and has not changed
 * offset since 1945, so a literal beats a tz database lookup here.
 */
const IST_OFFSET = "+05:30";
/** The same offset in minutes, for arithmetic on instants. */
const IST_OFFSET_MINUTES = 5 * 60 + 30;

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
 * The IST calendar date of an instant, as `YYYY-MM-DD` for a `<input type="date">`.
 *
 * <p>The inverse of {@link istRangeStart}, and the reason it exists: report screens
 * were filling their date boxes with `d.toISOString().slice(0, 10)`, which is the
 * date in **UTC**. For any zone ahead of UTC that is a different day for part of the
 * day, and for local midnight it is ALWAYS the day before — so a "this month" default
 * built from `new Date(y, m, 1)` rendered as the last day of the PREVIOUS month, every
 * time. On a GST summary that silently pulled a day of sales from the previous filing
 * period into the current one.
 *
 * <p>Anchored to IST rather than the browser's zone for the same reason as the range
 * helpers: the pharmacy's business day is IST wherever the viewer happens to be, and
 * these values are handed straight back to {@link istRangeStart}/{@link istRangeEnd}.
 */
export function istCalendarDate(date: Date = new Date()): string {
  if (isNaN(date.getTime())) return "";
  // Shift the instant by the offset, then read the UTC fields: the shifted clock
  // face IS the IST wall clock, and toISOString reads UTC without re-applying any
  // local-zone conversion.
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * First day of the IST month containing the given instant, as `YYYY-MM-DD`.
 *
 * <p>Derived from the IST date rather than `new Date(y, m, 1)`, whose local-midnight
 * result is what produced the off-by-one above.
 */
export function istMonthStart(date: Date = new Date()): string {
  const istDate = istCalendarDate(date);
  return istDate ? `${istDate.slice(0, 7)}-01` : "";
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

/**
 * The Indian financial year label used in document numbers, e.g. `"25-26"`.
 *
 * <p>Mirrors the backend's `DocumentSequenceService.fyShort()` exactly — same IST
 * anchor, same April-1 rollover, same two-digit form. That equivalence is the whole
 * point: this drives the live preview on the Invoice Settings screen while the
 * backend drives the number actually stamped on the bill, and if the two ever
 * disagreed the preview would once again be promising something the invoice does
 * not deliver.
 *
 * <p>Anchored to IST rather than the browser's zone for the same reason as
 * {@link istRangeStart}: the pharmacy's financial year is an Indian one no matter
 * where the person looking at the screen is sitting, and a device in another
 * timezone must not show a different year on 31 March / 1 April.
 */
export function financialYearShort(now: Date = new Date()): string {
  // Shift the instant into IST, then read the date parts off the UTC accessors —
  // this yields IST calendar values regardless of the host's own timezone.
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const year = ist.getUTCFullYear();
  const month = ist.getUTCMonth() + 1; // 1-12

  // The Indian FY runs April → March, so anything before April belongs to the
  // year that started the previous calendar year.
  const startYear = month >= 4 ? year : year - 1;
  const two = (y: number) => String(y % 100).padStart(2, "0");
  return `${two(startYear)}-${two(startYear + 1)}`;
}
