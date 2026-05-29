/**
 * In India, MRP is always GST-inclusive.
 * Pharmacy GST slabs: 0%, 5%, 12%
 */

export type GstBreakdown = {
  taxableAmount: number;
  cgst: number;
  sgst: number;
  totalGst: number;
  totalAmount: number;
};

export type InvoiceItemInput = {
  mrp: number;
  quantity: number;
  discount: number; // percentage 0-100
  gstRate: number;  // 0 | 5 | 12
};

export function calcGstFromMrp(
  mrp: number,
  quantity: number,
  discountPercent: number,
  gstRate: number
): GstBreakdown {
  const lineTotal = mrp * quantity;
  const discountAmount = (lineTotal * discountPercent) / 100;
  const amountAfterDiscount = lineTotal - discountAmount;

  // Reverse-calculate taxable from GST-inclusive MRP
  const taxableAmount = amountAfterDiscount / (1 + gstRate / 100);
  const totalGst = amountAfterDiscount - taxableAmount;
  const cgst = totalGst / 2;
  const sgst = totalGst / 2;

  return {
    taxableAmount: round(taxableAmount),
    cgst: round(cgst),
    sgst: round(sgst),
    totalGst: round(totalGst),
    totalAmount: round(amountAfterDiscount),
  };
}

export function calcInvoiceTotals(
  items: InvoiceItemInput[]
): Omit<GstBreakdown, "totalAmount"> & { subtotal: number; totalAmount: number; discountAmount: number } {
  let subtotal = 0;
  let discountAmount = 0;
  let taxableAmount = 0;
  let cgst = 0;
  let sgst = 0;

  for (const item of items) {
    const lineTotal = item.mrp * item.quantity;
    const lineDiscount = (lineTotal * item.discount) / 100;
    const afterDiscount = lineTotal - lineDiscount;
    const taxable = afterDiscount / (1 + item.gstRate / 100);
    const gst = afterDiscount - taxable;

    subtotal += lineTotal;
    discountAmount += lineDiscount;
    taxableAmount += taxable;
    cgst += gst / 2;
    sgst += gst / 2;
  }

  return {
    subtotal: round(subtotal),
    discountAmount: round(discountAmount),
    taxableAmount: round(taxableAmount),
    cgst: round(cgst),
    sgst: round(sgst),
    totalGst: round(cgst + sgst),
    totalAmount: round(taxableAmount + cgst + sgst),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
