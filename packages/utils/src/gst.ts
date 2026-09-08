/**
 * In India, MRP is always GST-inclusive.
 * Pharmacy GST slabs: 0%, 5%, 12%
 *
 * GST type depends on the sale:
 *   Intra-state → CGST + SGST (each at gstRate / 2)
 *   Inter-state → IGST (at full gstRate)
 */

export type GstBreakdown = {
  taxableAmount: number;
  cgst:          number;
  sgst:          number;
  igst:          number; // 0 for intra-state; full GST for inter-state
  totalGst:      number;
  totalAmount:   number;
};

export type InvoiceItemInput = {
  mrp:          number;
  quantity:     number;
  discount:     number; // percentage 0-100
  gstRate:      number; // 0 | 5 | 12
  isInterstate?: boolean;
};

/**
 * Per-piece price for a loose (cut-strip) sale: the printed pack MRP divided by
 * the pack size, at TWO DECIMAL PLACES ROUNDED DOWN. Mirrors
 * `GstCalculator.perPieceMrp` in the Java API exactly — the per-piece price is
 * charged and printed, so tax is reverse-calculated from it and `qty x rate` must
 * reconcile with the line amount; rounding down keeps
 * `perPiece x unitsPerPack <= pack MRP` (never above pro-rata MRP). Returns the
 * pack MRP unchanged when there is no real pack size, so a caller can apply it
 * unconditionally.
 */
export function perPieceMrp(packMrp: number, unitsPerPack: number | null | undefined): number {
  if (!unitsPerPack || unitsPerPack <= 1) return packMrp;
  // Round to 6dp first to shed binary-float noise, THEN floor to paise, so a value
  // like 2.2999999998 does not floor to 2.29.
  return Math.floor(Math.round((packMrp / unitsPerPack) * 1e6) / 1e4) / 100;
}

/**
 * Short label for a loose line's unit — "tab", "cap", "mL", "g", "u".
 *
 * Kept as its own tiny function (rather than routed through {@code saleUnitModel})
 * because every receipt/ledger call site has only the sale-time {@code baseUnit}
 * snapshot to hand, not the whole medicine. {@code saleUnitModel().looseUnitShort}
 * returns the identical set for callers that do have the medicine.
 */
export function baseUnitShort(baseUnit: string | null | undefined): string {
  switch (baseUnit) {
    case "TABLET":  return "tab";
    case "CAPSULE": return "cap";
    case "ML":      return "mL";
    case "GM":      return "g";
    default:        return "u";
  }
}

export function calcGstFromMrp(
  mrp:             number,
  quantity:        number,
  discountPercent: number,
  gstRate:         number,
  isInterstate =   false,
): GstBreakdown {
  const lineTotal           = mrp * quantity;
  const discountAmount      = (lineTotal * discountPercent) / 100;
  const amountAfterDiscount = lineTotal - discountAmount;

  // Reverse-calculate taxable from GST-inclusive MRP
  const taxableAmount = amountAfterDiscount / (1 + gstRate / 100);
  const totalGst      = amountAfterDiscount - taxableAmount;

  // Round taxable and the half-GST components first; derive totals from
  // rounded values so cgst+sgst===totalGst and taxable+totalGst===totalAmount.
  const roundedTaxable = round(taxableAmount);
  const halfGst        = round(totalGst / 2);

  if (isInterstate) {
    const igst = halfGst * 2; // keep symmetry with intra-state rounding
    return {
      taxableAmount: roundedTaxable,
      cgst:          0,
      sgst:          0,
      igst,
      totalGst:      igst,
      totalAmount:   roundedTaxable + igst,
    };
  }

  return {
    taxableAmount: roundedTaxable,
    cgst:          halfGst,
    sgst:          halfGst,
    igst:          0,
    totalGst:      halfGst * 2,
    totalAmount:   roundedTaxable + halfGst * 2,
  };
}

/**
 * Invoice totals, with an optional bill-level discount applied to every line BEFORE
 * tax is derived.
 *
 * Mirrors `GstCalculator.calcInvoiceTotals` in the Java API exactly — the cart preview
 * and the figure the server commits must be the same number, or the cashier is shown
 * one total and the customer is charged another.
 *
 * The discount reduces the taxable value because s.15(3) of the CGST Act excludes a
 * discount recorded on the invoice from the value of the supply. Deducting it after
 * the tax, as this used to, charged GST on money the pharmacy never collected.
 */
export function calcInvoiceTotals(
  items:          InvoiceItemInput[],
  isInterstate =  false,
  billDiscountPct = 0,
): Omit<GstBreakdown, "totalAmount"> & { subtotal: number; totalAmount: number; discountAmount: number } {
  const billFactor   = billDiscountPct > 0 ? 1 - Math.min(billDiscountPct, 100) / 100 : 1;
  let subtotal       = 0;
  let discountAmount = 0;
  let taxableAmount  = 0;
  let halfGstTotal   = 0;

  for (const item of items) {
    const lineTotal    = item.mrp * item.quantity;
    const lineDiscount = (lineTotal * item.discount) / 100;
    const afterLineDiscount = lineTotal - lineDiscount;
    const afterDiscount = afterLineDiscount * billFactor;
    const taxable      = afterDiscount / (1 + item.gstRate / 100);
    const gst          = afterDiscount - taxable;

    subtotal       += lineTotal;
    // Both kinds of discount in the single figure the customer reads.
    discountAmount += lineDiscount + (afterLineDiscount - afterDiscount);
    taxableAmount  += taxable;
    halfGstTotal   += gst / 2;
  }

  const roundedTaxable = round(taxableAmount);
  const roundedHalf    = round(halfGstTotal);

  if (isInterstate) {
    const igst = roundedHalf * 2;
    return {
      subtotal:       round(subtotal),
      discountAmount: round(discountAmount),
      taxableAmount:  roundedTaxable,
      cgst:           0,
      sgst:           0,
      igst,
      totalGst:       igst,
      totalAmount:    roundedTaxable + igst,
    };
  }

  return {
    subtotal:       round(subtotal),
    discountAmount: round(discountAmount),
    taxableAmount:  roundedTaxable,
    cgst:           roundedHalf,
    sgst:           roundedHalf,
    igst:           0,
    totalGst:       roundedHalf * 2,
    totalAmount:    roundedTaxable + roundedHalf * 2,
  };
}

// ─── Purchase-side GST ───────────────────────────────────────────────────────
// Supplier cost prices in Indian B2B trade are GST-exclusive (tax is added on
// top), which is the opposite of retail MRP (GST-inclusive). This function
// forward-calculates GST from cost price rather than reverse-calculating from MRP.
//
// Use this for Purchase Orders and GRNs.
// Use calcGstFromMrp for billing/invoices.

export type PurchaseLineGST = {
  lineTotal: number; // cost after discount, GST-exclusive
  cgst:      number;
  sgst:      number;
  igst:      number;
  totalGst:  number;
  amount:    number; // lineTotal + totalGst (the supplier invoice amount)
};

export function calcPurchaseLineGST(
  costPrice:   number,
  quantity:    number,
  discount:    number,    // percentage 0–100, pass 0 for purchase orders with no discount
  gstRate:     number,    // 0 | 5 | 12
  isInterstate = false,
): PurchaseLineGST {
  const gross     = costPrice * quantity;
  const lineTotal = round(gross * (1 - discount / 100));
  const halfGst   = round((lineTotal * gstRate) / 100 / 2);

  if (isInterstate) {
    const igst = halfGst * 2;
    return { lineTotal, cgst: 0, sgst: 0, igst, totalGst: igst, amount: round(lineTotal + igst) };
  }

  return {
    lineTotal,
    cgst:     halfGst,
    sgst:     halfGst,
    igst:     0,
    totalGst: halfGst * 2,
    amount:   round(lineTotal + halfGst * 2),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
