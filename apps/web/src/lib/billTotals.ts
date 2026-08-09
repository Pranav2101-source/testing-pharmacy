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
  /** Rounding delta applied to reach a whole rupee (Indian retail convention). */
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
   * Item total after item-level discounts, the BILL-LEVEL discount, and GST.
   *
   * The bill discount used to be subtracted here, after tax. It now reduces the
   * taxable value inside `calcInvoiceTotals` instead, because a discount recorded on
   * the invoice is excluded from the value of the supply (s.15(3) CGST Act) — so it
   * is already inside this figure and must not be applied a second time.
   */
  itemsTotal: number;
  extraCharges: number;
  adjustmentAmount: number;
}): NetPayable {
  const { itemsTotal, extraCharges, adjustmentAmount } = params;

  const preRound = itemsTotal + extraCharges + adjustmentAmount;

  // A bill that is exactly zero is legitimate (100% discount, free-of-charge
  // dispensing) and the backend allows it. Only a genuinely negative one is not.
  const shortfall = preRound < 0 ? Math.abs(preRound) : 0;

  const roundOff = Math.round(preRound) - preRound;
  return { preRound, roundOff, netPayable: preRound + roundOff, shortfall };
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
