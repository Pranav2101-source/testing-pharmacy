/**
 * The one place bill-level adjustments turn into a payable figure.
 *
 * Item GST comes from `@pharmacy/utils` (shared with the backend); this covers the
 * step AFTER that — bill discount, extra charges, manual adjustment, and the
 * round-to-nearest-rupee that Indian retail expects.
 *
 * WHY THIS EXISTS AS A MODULE
 *
 * The formula was written out twice, in BillingNewPage's `netPayable` memo and in
 * InvoiceBreakdownModal's `calcBreakdown`, and both clamped a negative result to
 * zero with `Math.max(0, …)`. The backend does the opposite: `BillingService`
 * REFUSES a negative pre-round total (422, "Discounts and adjustments exceed the
 * value of this bill by Rs.X") precisely so a nonsense bill can't be issued,
 * numbered, and have stock decremented against it.
 *
 * The two behaviours together produced the worst outcome for the cashier: enter a
 * −₹500 adjustment on a ₹200 bill and the screen shows a confident ₹0.00, which
 * reads as a legitimate free-of-charge sale. Only on pressing Save does the server
 * reject it, and the error names figures the screen never displayed.
 *
 * So the clamp is gone. `shortfall` reports the overshoot, the UI can say so
 * BEFORE the round trip, and the number on screen is the number the server will
 * agree with.
 */

export type NetPayable = {
  /** Payable before rupee-rounding. Negative when adjustments exceed the goods. */
  preRound: number;
  /**
   * The signed delta that makes the invoice foot from its own columns:
   *   taxableAmount + totalGst + extraCharges + adjustmentAmount + roundOff == netPayable
   * It carries the rupee rounding AND the sub-paisa the equal CGST/SGST split cannot
   * represent (the line totals are the customer-facing prices, not a sum of rounded tax
   * parts — see `calcGstFromMrp`). Mirrors `BillingService`'s stored `roundOff` exactly.
   * Falls back to just the rupee rounding when the tax breakdown isn't supplied.
   */
  roundOff: number;
  /** What the customer pays, rounded to the nearest rupee. */
  netPayable: number;
  /**
   * How far below zero the bill went, as a positive number; 0 when the bill is
   * valid. Non-zero means the backend will reject this bill — block the save and
   * tell the cashier which field to fix.
   */
  shortfall: number;
};

export function computeNetPayable(params: {
  /**
   * Sum of the line totals the customer pays, after item- and bill-level discounts and GST
   * — i.e. `calcInvoiceTotals(...).totalAmount`. Each line total is the gross price paid,
   * not a sum of rounded tax parts (see `calcGstFromMrp`). The bill discount is already
   * inside this figure (s.15(3) CGST Act — it reduces the taxable value in
   * `calcInvoiceTotals`) and must not be applied again here.
   */
  itemsTotal: number;
  extraCharges: number;
  adjustmentAmount: number;
  /**
   * `taxableAmount + totalGst` from the same `calcInvoiceTotals` call. When supplied,
   * `roundOff` is the delta that makes the invoice foot from its STORED columns —
   * `taxable + tax + charges + adjustment + roundOff == netPayable` — matching
   * `BillingService` exactly (it carries the rupee rounding plus the equal-split paisa).
   * Omitted → `roundOff` is just the rupee rounding, as before.
   */
  taxAndGst?: number;
}): NetPayable {
  const { itemsTotal, extraCharges, adjustmentAmount, taxAndGst } = params;

  const preRound = itemsTotal + extraCharges + adjustmentAmount;

  // A bill that is exactly zero is legitimate (100% discount, free-of-charge
  // dispensing) and the backend allows it. Only a genuinely negative one is not.
  const shortfall = preRound < 0 ? Math.abs(preRound) : 0;

  const netPayable = Math.round(preRound);
  const roundOff = round2(
    netPayable - (taxAndGst != null ? taxAndGst + extraCharges + adjustmentAmount : preRound),
  );
  return { preRound, roundOff, netPayable, shortfall };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * The sentence shown to the cashier when adjustments have over-run the bill.
 * Deliberately mirrors the backend's 422 wording so the pre-flight warning and the
 * server's rejection cannot contradict each other.
 */
export function shortfallMessage(shortfall: number): string {
  return (
    `Discounts and adjustments exceed the value of this bill by ₹${shortfall.toFixed(2)}. ` +
    `Check the bill discount, extra charges and adjustment amount.`
  );
}
