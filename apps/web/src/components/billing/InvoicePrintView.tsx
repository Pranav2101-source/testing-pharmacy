"use client";
import { forwardRef } from "react";
import { format } from "date-fns";
import { formatCurrency, formatAmountInWords } from "@pharmacy/utils";

export type PrintInvoiceData = {
  invoiceNumber: string;
  createdAt: string;
  customerName?: string;
  customerPhone?: string;
  doctorName?: string;
  paymentMode: string;
  paymentStatus: string;
  isInterstate?: boolean;
  items: Array<{
    medicineName: string;
    hsnCode: string | null;
    batchNumber: string;
    expiryDate: string;
    mrp: number;
    quantity: number;
    discount: number;
    gstRate: number;
    rate: number;
    taxableAmount: number;
    cgst: number;
    sgst: number;
    igst: number;
    amount: number;
  }>;
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGst: number;
  totalAmount: number;
};

type Props = { invoice: PrintInvoiceData };

export const InvoicePrintView = forwardRef<HTMLDivElement, Props>(
  function InvoicePrintView({ invoice }, ref) {
    const roundedTotal = Math.round(invoice.totalAmount);
    const roundOff = roundedTotal - invoice.totalAmount;

    const isInterstate = invoice.isInterstate ?? false;

    // GST slab summary
    const slabs = invoice.items.reduce<
      Record<number, { taxable: number; cgst: number; sgst: number; igst: number }>
    >((acc, item) => {
      if (!acc[item.gstRate]) acc[item.gstRate] = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      acc[item.gstRate]!.taxable += item.taxableAmount;
      acc[item.gstRate]!.cgst   += item.cgst;
      acc[item.gstRate]!.sgst   += item.sgst;
      acc[item.gstRate]!.igst   += item.igst;
      return acc;
    }, {});

    return (
      <div
        ref={ref}
        className="bg-white font-sans text-gray-900"
        style={{ width: "210mm", minHeight: "297mm", padding: "10mm", fontSize: "10px", lineHeight: "1.4" }}
      >
        {/* ── Header ── */}
        <div style={{ borderBottom: "2px solid #1a1a1a", paddingBottom: "10px", marginBottom: "12px", textAlign: "center" }}>
          <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>Checkup Pharmacy</h1>
          <p style={{ color: "#555", margin: "4px 0 2px" }}>
            123 Main Street, City · +91 98765 43210
          </p>
          <p style={{ color: "#555", margin: 0 }}>
            GSTIN: 27ABCDE1234F1Z5 · Drug Lic: MH-1234
          </p>
          <div style={{
            display: "inline-block",
            background: "#1a1a1a",
            color: "#fff",
            padding: "2px 14px",
            borderRadius: "4px",
            marginTop: "8px",
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.08em",
          }}>
            TAX INVOICE
          </div>
        </div>

        {/* ── Invoice meta ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "12px" }}>
          <div style={{ lineHeight: "1.8" }}>
            <p><strong>Invoice No:</strong> {invoice.invoiceNumber}</p>
            <p><strong>Date:</strong> {format(new Date(invoice.createdAt), "dd/MM/yyyy HH:mm")}</p>
            <p><strong>Payment:</strong> {invoice.paymentMode} — {invoice.paymentStatus}</p>
          </div>
          <div style={{ lineHeight: "1.8" }}>
            {invoice.customerName && <p><strong>Patient:</strong> {invoice.customerName}</p>}
            {invoice.customerPhone && <p><strong>Phone:</strong> {invoice.customerPhone}</p>}
            {invoice.doctorName && <p><strong>Doctor:</strong> {invoice.doctorName}</p>}
          </div>
        </div>

        {/* ── Items table ── */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "14px", fontSize: "9.5px" }}>
          <thead>
            <tr style={{ background: "#1a1a1a", color: "#fff" }}>
              {["#", "Medicine", "HSN", "Batch", "Exp", "MRP", "Qty", "Disc%", "Taxable", "GST%",
                ...(isInterstate ? ["IGST"] : ["CGST", "SGST"]),
                "Amount"].map((h) => (
                <th key={h} style={{ padding: "5px 6px", textAlign: h === "#" || h === "Qty" || h === "GST%" ? "center" : ["Medicine", "HSN", "Batch", "Exp"].includes(h) ? "left" : "right", fontWeight: 600, whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f9f9f9" }}>
                <td style={{ padding: "4px 6px", textAlign: "center", borderBottom: "1px solid #eee" }}>{i + 1}</td>
                <td style={{ padding: "4px 6px", borderBottom: "1px solid #eee", fontWeight: 500 }}>{item.medicineName}</td>
                <td style={{ padding: "4px 6px", borderBottom: "1px solid #eee", color: "#666" }}>{item.hsnCode || "—"}</td>
                <td style={{ padding: "4px 6px", borderBottom: "1px solid #eee", fontFamily: "monospace" }}>{item.batchNumber}</td>
                <td style={{ padding: "4px 6px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                  {format(new Date(item.expiryDate), "MM/yy")}
                </td>
                <td style={{ padding: "4px 6px", borderBottom: "1px solid #eee", textAlign: "right" }}>₹{item.mrp.toFixed(2)}</td>
                <td style={{ padding: "4px 6px", borderBottom: "1px solid #eee", textAlign: "center" }}>{item.quantity}</td>
                <td style={{ padding: "4px 6px", borderBottom: "1px solid #eee", textAlign: "right" }}>
                  {item.discount > 0 ? `${item.discount}%` : "—"}
                </td>
                <td style={{ padding: "4px 6px", borderBottom: "1px solid #eee", textAlign: "right" }}>₹{item.taxableAmount.toFixed(2)}</td>
                <td style={{ padding: "4px 6px", borderBottom: "1px solid #eee", textAlign: "center" }}>{item.gstRate}%</td>
                {isInterstate
                  ? <td style={{ padding: "4px 6px", borderBottom: "1px solid #eee", textAlign: "right" }}>₹{item.igst.toFixed(2)}</td>
                  : <>
                      <td style={{ padding: "4px 6px", borderBottom: "1px solid #eee", textAlign: "right" }}>₹{item.cgst.toFixed(2)}</td>
                      <td style={{ padding: "4px 6px", borderBottom: "1px solid #eee", textAlign: "right" }}>₹{item.sgst.toFixed(2)}</td>
                    </>
                }
                <td style={{ padding: "4px 6px", borderBottom: "1px solid #eee", textAlign: "right", fontWeight: 600 }}>₹{item.amount.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── Totals + GST slab summary ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "12px" }}>
          {/* GST summary */}
          <div>
            <p style={{ fontWeight: 600, marginBottom: "6px", color: "#333" }}>GST Summary</p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9.5px", border: "1px solid #ccc" }}>
              <thead>
                <tr style={{ background: "#f0f0f0" }}>
                  <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "left" }}>Rate</th>
                  <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "right" }}>Taxable</th>
                  {isInterstate
                    ? <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "right" }}>IGST</th>
                    : <>
                        <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "right" }}>CGST</th>
                        <th style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "right" }}>SGST</th>
                      </>
                  }
                </tr>
              </thead>
              <tbody>
                {Object.entries(slabs)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([rate, v]) => (
                    <tr key={rate}>
                      <td style={{ border: "1px solid #ccc", padding: "4px 6px" }}>{rate}%</td>
                      <td style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "right" }}>₹{v.taxable.toFixed(2)}</td>
                      {isInterstate
                        ? <td style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "right" }}>₹{v.igst.toFixed(2)}</td>
                        : <>
                            <td style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "right" }}>₹{v.cgst.toFixed(2)}</td>
                            <td style={{ border: "1px solid #ccc", padding: "4px 6px", textAlign: "right" }}>₹{v.sgst.toFixed(2)}</td>
                          </>
                      }
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Invoice totals */}
          <div style={{ fontSize: "10px" }}>
            {[
              { label: "Subtotal (MRP)", value: formatCurrency(invoice.subtotal) },
              ...(invoice.discountAmount > 0
                ? [{ label: "Discount", value: `− ${formatCurrency(invoice.discountAmount)}`, color: "#16a34a" }]
                : []),
              { label: "Taxable Amount", value: formatCurrency(invoice.taxableAmount) },
              ...(isInterstate
                ? [{ label: "IGST", value: formatCurrency(invoice.igst) }]
                : [
                    { label: "CGST", value: formatCurrency(invoice.cgst) },
                    { label: "SGST", value: formatCurrency(invoice.sgst) },
                  ]),
              ...(Math.abs(roundOff) >= 0.01
                ? [{ label: "Round Off", value: `${roundOff > 0 ? "+" : ""}${roundOff.toFixed(2)}`, color: "#999" }]
                : []),
            ].map(({ label, value, color }) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: color ?? "#333", borderBottom: "1px solid #f0f0f0" }}>
                <span>{label}</span>
                <span>{value}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0 4px", borderTop: "2px solid #1a1a1a", fontWeight: 700, fontSize: "13px", marginTop: "4px" }}>
              <span>Total</span>
              <span>₹{roundedTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* ── Amount in words ── */}
        <div style={{ background: "#f5f5f5", border: "1px solid #e0e0e0", borderRadius: "4px", padding: "6px 10px", marginBottom: "16px", fontSize: "9.5px" }}>
          <strong>Amount in Words: </strong>
          <em>{formatAmountInWords(roundedTotal)}</em>
        </div>

        {/* ── Footer ── */}
        <div style={{ borderTop: "1px solid #ccc", paddingTop: "10px", display: "grid", gridTemplateColumns: "1fr 1fr", fontSize: "9px", color: "#666" }}>
          <div>
            <p style={{ fontWeight: 600, color: "#333", marginBottom: "4px" }}>Terms & Conditions</p>
            <p>• Medicines once sold will not be returned.</p>
            <p>• This is a computer-generated invoice.</p>
            <p>• All disputes subject to local jurisdiction.</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ marginTop: "30px", borderTop: "1px solid #999", paddingTop: "4px", display: "inline-block", minWidth: "120px" }}>
              <p style={{ fontWeight: 600, color: "#333" }}>Authorized Signature</p>
              <p>Checkup Pharmacy</p>
            </div>
          </div>
        </div>
      </div>
    );
  }
);
