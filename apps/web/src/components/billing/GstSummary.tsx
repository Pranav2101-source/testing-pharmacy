"use client";
import { useBillingStore } from "./useBillingStore";
import { formatCurrency, formatAmountInWords } from "@pharmacy/utils";

export function GstSummary() {
  const items = useBillingStore((s) => s.items);
  const getTotals = useBillingStore((s) => s.getTotals);

  if (items.length === 0) {
    return (
      <p className="text-xs text-gray-400 text-center py-2">
        Add items to see totals
      </p>
    );
  }

  const totals = getTotals();
  const roundedTotal = Math.round(totals.totalAmount);
  const roundOff = roundedTotal - totals.totalAmount;

  // Group items by GST slab
  const slabs = items.reduce<Record<number, { taxable: number; cgst: number; sgst: number }>>(
    (acc, item) => {
      if (!acc[item.gstRate]) acc[item.gstRate] = { taxable: 0, cgst: 0, sgst: 0 };
      acc[item.gstRate]!.taxable += item.taxableAmount;
      acc[item.gstRate]!.cgst += item.cgst;
      acc[item.gstRate]!.sgst += item.sgst;
      return acc;
    },
    {}
  );

  return (
    <div className="space-y-2 text-sm">
      <div className="flex justify-between text-gray-600">
        <span>Subtotal (MRP)</span>
        <span>{formatCurrency(totals.subtotal)}</span>
      </div>

      {totals.discountAmount > 0 && (
        <div className="flex justify-between text-green-600">
          <span>Discount</span>
          <span>− {formatCurrency(totals.discountAmount)}</span>
        </div>
      )}

      <div className="flex justify-between text-gray-600">
        <span>Taxable Amount</span>
        <span>{formatCurrency(totals.taxableAmount)}</span>
      </div>

      {/* GST slab breakdown */}
      <div className="rounded-lg border border-gray-100 overflow-hidden">
        <div className="grid grid-cols-4 bg-gray-50 px-2 py-1.5 text-xs font-semibold text-gray-500 border-b border-gray-100">
          <span>GST%</span>
          <span className="text-right">Taxable</span>
          <span className="text-right">CGST</span>
          <span className="text-right">SGST</span>
        </div>
        {Object.entries(slabs)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([rate, vals]) => (
            <div key={rate} className="grid grid-cols-4 px-2 py-1.5 text-xs text-gray-600 border-b border-gray-50 last:border-0">
              <span className="font-medium">{rate}%</span>
              <span className="text-right">{formatCurrency(vals.taxable)}</span>
              <span className="text-right">{formatCurrency(vals.cgst)}</span>
              <span className="text-right">{formatCurrency(vals.sgst)}</span>
            </div>
          ))}
      </div>

      <div className="flex justify-between text-gray-600">
        <span>Total GST (CGST + SGST)</span>
        <span>{formatCurrency(totals.totalGst)}</span>
      </div>

      {Math.abs(roundOff) >= 0.01 && (
        <div className="flex justify-between text-gray-400 text-xs">
          <span>Round Off</span>
          <span>{roundOff > 0 ? "+" : ""}{roundOff.toFixed(2)}</span>
        </div>
      )}

      <div className="flex justify-between font-bold text-base text-gray-900 border-t border-gray-200 pt-2 mt-1">
        <span>Total</span>
        <span>{formatCurrency(roundedTotal)}</span>
      </div>

      <p className="text-xs text-gray-400 italic leading-relaxed">
        {formatAmountInWords(roundedTotal)}
      </p>
    </div>
  );
}
