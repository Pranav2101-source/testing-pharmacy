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

export function calcInvoiceTotals(
  items:          InvoiceItemInput[],
  isInterstate =  false,
): Omit<GstBreakdown, "totalAmount"> & { subtotal: number; totalAmount: number; discountAmount: number } {
  let subtotal       = 0;
  let discountAmount = 0;
  let taxableAmount  = 0;
  let halfGstTotal   = 0;

  for (const item of items) {
    const lineTotal    = item.mrp * item.quantity;
    const lineDiscount = (lineTotal * item.discount) / 100;
    const afterDiscount = lineTotal - lineDiscount;
    const taxable      = afterDiscount / (1 + item.gstRate / 100);
    const gst          = afterDiscount - taxable;

    subtotal       += lineTotal;
    discountAmount += lineDiscount;
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
