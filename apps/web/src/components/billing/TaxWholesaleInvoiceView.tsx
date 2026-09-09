"use client";
import { forwardRef } from "react";
import { format } from "date-fns";
import { formatCurrency, formatAmountInWords } from "@pharmacy/utils";
import { normalizeInvoiceSettings } from "@pharmacy/types";
import type { InvoiceSettingsConfig } from "@pharmacy/types";
import { QRCodeSVG } from "qrcode.react";
import { buildUpiUri } from "@/lib/upiQr";
import type { PrintInvoiceData, PharmacyProfile } from "./InvoicePrintView";

// ─── Tax / Wholesale invoice layout ───────────────────────────────────────────
// A4 page (landscape) GST tax invoice: bordered fixed-height item grid with a
// "Column Totals" row, an optional Buyer-GSTIN / "Wholesale Details" block, a
// 3-column footer band (Bank Details + UPI QR / GST Summary / Totals) and a
// Terms + Authorized-Signature strip.
//
// Selected via `config.theme === "tax-wholesale"` (see lib/invoiceRenderer.ts).
// Honours the SAME content toggles as InvoicePrintView — every Table Columns,
// Financial Summary and Patient Info switch means the same thing here — plus
// `paper.marginMm` / `paper.contentScale` / `paper.minRows` for page geometry.

type Item = PrintInvoiceData["items"][number];

const clamp = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;

const PREVIEW_PHARMACY: PharmacyProfile = {
  name:        "Checkup Pharmacy",
  address:     "123 MG Road, Andheri West, Mumbai 400058",
  phone:       "+91 98765 43210",
  email:       "info@checkuppharmacy.com",
  gstin:       "27ABCDE1234F1Z5",
  drugLicense: "MH-MUM-1234",
  state:       "Maharashtra",
};

type Props = {
  invoice:   PrintInvoiceData;
  config?:   Partial<InvoiceSettingsConfig>;
  pharmacy?: PharmacyProfile;
};

export const TaxWholesaleInvoiceView = forwardRef<HTMLDivElement, Props>(
  function TaxWholesaleInvoiceView({ invoice, config: configProp, pharmacy: pharmacyProp }, ref) {
    const cfg      = normalizeInvoiceSettings(configProp);
    const pharmacy = pharmacyProp ?? PREVIEW_PHARMACY;

    // A cut-strip line legally needs batch + expiry + the pack MRP and per-piece
    // rate on the bill regardless of the column toggles — same rule as the A4 view.
    const hasLoose = invoice.items.some((it) => it.saleUnit === "LOOSE");
    const col = hasLoose
      ? { ...cfg.columns, showBatch: true, showExpiry: true, showMrp: true, showRate: true }
      : cfg.columns;
    const hdr  = cfg.header;
    const pat  = cfg.patient;
    const tot  = cfg.totals;
    const ftr  = cfg.footer;
    const br   = cfg.branding;
    const bank = cfg.bank;

    // ── Page geometry (pharmacy-adjustable) ───────────────────────────────────
    const marginMm = clamp(cfg.paper.marginMm ?? 10, 4, 25);
    const scale    = clamp(cfg.paper.contentScale ?? 1, 0.75, 1.25);
    const minRows  = Math.round(clamp(cfg.paper.minRows ?? 8, 0, 20));
    /** Scaled px — every size in this layout goes through here so contentScale is uniform. */
    const z = (px: number) => `${+(px * scale).toFixed(2)}px`;

    const primary       = br.primaryColor || "#111827";
    const displayName   = br.pharmacyNameOverride || pharmacy.name;
    const isInterstate  = invoice.isInterstate ?? false;
    const placeOfSupply = invoice.placeOfSupply || pharmacy.state || "";

    // Totals block foots from its own rows — identical maths to InvoicePrintView
    // and ThermalReceiptView so all three formats agree on the same bill.
    const extraCharges  = invoice.extraCharges ?? 0;
    const adjustment    = invoice.adjustmentAmount ?? 0;
    const taxAndCharges = invoice.taxableAmount + invoice.totalGst + extraCharges + adjustment;
    const roundOff      = invoice.roundOff ?? (Math.round(taxAndCharges) - taxAndCharges);
    const roundedTotal  = Math.round(taxAndCharges + roundOff);

    // GST slab summary (compliance: slab-wise breakup is a locked-on field).
    const slabs = invoice.items.reduce<
      Record<number, { taxable: number; cgst: number; sgst: number; igst: number }>
    >((acc, item) => {
      if (!acc[item.gstRate]) acc[item.gstRate] = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      acc[item.gstRate]!.taxable += item.taxableAmount;
      acc[item.gstRate]!.cgst    += item.cgst;
      acc[item.gstRate]!.sgst    += item.sgst;
      acc[item.gstRate]!.igst    += item.igst || (item.cgst + item.sgst);
      return acc;
    }, {});

    const upiUri = ftr.showQrCode && ftr.upiId
      ? buildUpiUri({ pa: ftr.upiId, pn: displayName, am: roundedTotal, tn: invoice.invoiceNumber })
      : null;

    const igstOf = (it: Item) => it.igst || (it.cgst + it.sgst);

    // ── Column model — one place, kept in sync across head / body / totals ─────
    const sum = (f: (it: Item) => number) => invoice.items.reduce((a, it) => a + f(it), 0);
    type Column = {
      key: string;
      header: string;
      align: "left" | "center" | "right";
      cell: (it: Item, i: number) => React.ReactNode;
      total?: number;
      width?: string;
    };
    const columns: Column[] = [
      { key: "sn",   header: "SN",    align: "center", width: z(34), cell: (_it, i) => i + 1 },
      { key: "name", header: "Items", align: "left",   cell: (it) => (
          <>
            {it.medicineName}
            {it.saleUnit === "LOOSE" && (
              <span style={{ color: "#a16207", fontSize: z(8) }}> · loose</span>
            )}
          </>
        ) },
      ...(col.showHsn ? [{ key: "hsn", header: "HSN", align: "left" as const, width: z(58),
        cell: (it: Item) => it.hsnCode || "—" }] : []),
      ...(col.showBatch ? [{ key: "batch", header: "Batch", align: "left" as const, width: z(64),
        cell: (it: Item) => it.batchNumber }] : []),
      ...(col.showExpiry ? [{ key: "exp", header: "Exp", align: "center" as const, width: z(50),
        cell: (it: Item) => format(new Date(it.expiryDate), "MM/yy") }] : []),
      ...(col.showMrp ? [{ key: "mrp", header: "MRP", align: "right" as const, width: z(62),
        cell: (it: Item) => it.mrp.toFixed(2) }] : []),
      ...(col.showRate ? [{ key: "rate", header: "Rate", align: "right" as const, width: z(62),
        cell: (it: Item) => it.rate.toFixed(2) }] : []),
      ...(col.showFreeQty ? [{ key: "free", header: "Free", align: "right" as const, width: z(48),
        cell: (it: Item) => (it.freeQty ? it.freeQty.toFixed(2) : "0.00"),
        total: sum((it) => it.freeQty ?? 0) }] : []),
      ...(col.showDiscount ? [{ key: "disc", header: "Disc", align: "right" as const, width: z(48),
        cell: (it: Item) => (it.discount > 0 ? `${it.discount}%` : "0") }] : []),
      ...(col.showGstRate && !isInterstate ? [
        { key: "cgst", header: "CGST", align: "right" as const, width: z(62),
          cell: (it: Item) => it.cgst.toFixed(2), total: sum((it) => it.cgst) },
        { key: "sgst", header: "SGST", align: "right" as const, width: z(62),
          cell: (it: Item) => it.sgst.toFixed(2), total: sum((it) => it.sgst) },
      ] : []),
      ...(col.showGstRate && isInterstate ? [
        { key: "igst", header: "IGST", align: "right" as const, width: z(70),
          cell: (it: Item) => igstOf(it).toFixed(2), total: sum(igstOf) },
      ] : []),
      { key: "total", header: "Total", align: "right", width: z(76),
        cell: (it: Item) => it.amount.toFixed(2), total: sum((it) => it.amount) },
    ];
    const firstTotalIdx = columns.findIndex((c) => c.total !== undefined);
    const blankRows = Math.max(0, minRows - invoice.items.length);

    // ── Style tokens ─────────────────────────────────────────────────────────
    const paperStyle: React.CSSProperties = {
      width: "297mm", minHeight: "210mm", padding: `${marginMm}mm`,
      background: "#fff", color: "#111827", fontSize: z(10),
      fontFamily: "Arial, Helvetica, sans-serif", lineHeight: 1.4,
      boxSizing: "border-box",
    };
    const box: React.CSSProperties = { border: "1px solid #9ca3af", padding: `${z(8)} ${z(10)}` };
    const th: React.CSSProperties = {
      border: "1px solid #6b7280", padding: `${z(4)} ${z(6)}`, fontWeight: 700,
      background: "#f3f4f6", whiteSpace: "nowrap",
    };
    const td = (align: "left" | "center" | "right"): React.CSSProperties => ({
      border: "1px solid #9ca3af", padding: `${z(4)} ${z(6)}`, textAlign: align,
    });
    const labelVal: React.CSSProperties = {
      display: "flex", justifyContent: "space-between", gap: z(8), padding: `${z(2)} 0`,
    };
    const boxTitle: React.CSSProperties = { fontWeight: 700, marginBottom: z(3) };

    // ── Financial Summary rows (each gated by its toggle, exactly like the A4 view) ──
    const totalRows: React.ReactNode[] = [];
    if (tot.showSubtotal) {
      totalRows.push(
        <div key="sub" style={labelVal}><span>Subtotal (MRP)</span><span>{invoice.subtotal.toFixed(2)}</span></div>,
      );
    }
    if (tot.showDiscount && invoice.discountAmount > 0) {
      totalRows.push(
        <div key="disc" style={{ ...labelVal, color: "#15803d" }}>
          <span>Discount</span><span>− {invoice.discountAmount.toFixed(2)}</span>
        </div>,
      );
    }
    if (tot.showSavings && invoice.discountAmount > 0) {
      totalRows.push(
        <div key="save" style={{ ...labelVal, color: "#15803d" }}>
          <span>You Save</span><span>{invoice.discountAmount.toFixed(2)}</span>
        </div>,
      );
    }
    if (tot.showTaxable) {
      totalRows.push(
        <div key="tax" style={labelVal}><span>Taxable</span><span>{invoice.taxableAmount.toFixed(2)}</span></div>,
      );
    }
    if (extraCharges > 0) {
      totalRows.push(
        <div key="extra" style={labelVal}><span>Extra Charges</span><span>{extraCharges.toFixed(2)}</span></div>,
      );
    }
    if (Math.abs(adjustment) >= 0.005) {
      totalRows.push(
        <div key="adj" style={labelVal}>
          <span>Adjustment</span><span>{adjustment > 0 ? "+" : "−"}{Math.abs(adjustment).toFixed(2)}</span>
        </div>,
      );
    }
    totalRows.push(
      <div key="grand" style={labelVal}><span>Grand Total</span><span>{taxAndCharges.toFixed(2)}</span></div>,
    );
    if (tot.showRoundOff && Math.abs(roundOff) >= 0.005) {
      totalRows.push(
        <div key="round" style={{ ...labelVal, color: "#6b7280" }}>
          <span>Round Off</span><span>{roundOff > 0 ? "+" : "−"}{Math.abs(roundOff).toFixed(2)}</span>
        </div>,
      );
    }

    // ── GST Summary rows (slab list + per-tax totals, each gated) ─────────────
    const showCgstRow = !isInterstate && tot.showCgst;
    const showSgstRow = !isInterstate && tot.showSgst;
    const showIgstRow = isInterstate && tot.showIgst;

    // ── Patient / Invoice-details right box ──────────────────────────────────
    const rightBoxRows: React.ReactNode[] = [];
    if (tot.showPaymentMode) {
      rightBoxRows.push(<div key="pay">Payment: {invoice.paymentMode} — {invoice.paymentStatus}</div>);
    }
    if (pat.showInvoiceDate) {
      rightBoxRows.push(<div key="date">Date: {format(new Date(invoice.createdAt), "dd-MM-yyyy")}</div>);
    }
    if (pat.showCashier && invoice.cashierName) {
      rightBoxRows.push(<div key="cash">Cashier: {invoice.cashierName}</div>);
    }

    return (
      <div ref={ref} style={paperStyle}>

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: z(16) }}>
          <div style={{
            display: "flex", gap: z(12),
            // Header Alignment (Left / Center / Right) positions the pharmacy block:
            // left keeps the logo beside the text; center/right stack it above.
            flexDirection: hdr.align === "left" ? "row" : "column",
            alignItems: hdr.align === "center" ? "center" : hdr.align === "right" ? "flex-end" : "flex-start",
          }}>
            {br.showLogo && br.logoUrl && (
              <img
                src={br.logoUrl}
                alt="logo"
                style={{
                  width: br.logoSize === "small" ? z(64) : br.logoSize === "large" ? z(120) : z(92),
                  height: br.logoSize === "small" ? z(64) : br.logoSize === "large" ? z(120) : z(92),
                  objectFit: "contain", border: "1px dashed #9ca3af", padding: z(4), boxSizing: "border-box",
                }}
              />
            )}
            <div style={{ textAlign: hdr.align }}>
              {hdr.showName && (
                <div style={{
                  fontSize: z(20), color: primary,
                  fontWeight: br.pharmacyNameStyle === "bold" ? 800 : br.pharmacyNameStyle === "italic" ? 500 : 700,
                  fontStyle: br.pharmacyNameStyle === "italic" ? "italic" : "normal",
                }}>
                  {displayName}
                </div>
              )}
              {hdr.showAddress && pharmacy.address && (
                <div style={{ color: "#4b5563", marginTop: z(2) }}>{pharmacy.address}</div>
              )}
              <div style={{ color: "#4b5563", marginTop: z(2) }}>
                {[
                  hdr.showGstin && pharmacy.gstin ? `GSTIN: ${pharmacy.gstin}` : null,
                  hdr.showDrugLicense && pharmacy.drugLicense ? `DL No: ${pharmacy.drugLicense}` : null,
                  hdr.showFssai && pharmacy.fssai ? `FSSAI: ${pharmacy.fssai}` : null,
                ].filter(Boolean).join("  |  ")}
              </div>
              <div style={{ color: "#4b5563", marginTop: z(2) }}>
                {[
                  hdr.showPhone && pharmacy.phone ? `Phone: ${pharmacy.phone}` : null,
                  hdr.showEmail && pharmacy.email ? `Email: ${pharmacy.email}` : null,
                  hdr.showWebsite && pharmacy.website ? pharmacy.website : null,
                ].filter(Boolean).join("  |  ")}
              </div>
              {hdr.customText && (
                <div style={{ color: "#6b7280", marginTop: z(2), fontSize: z(9) }}>{hdr.customText}</div>
              )}
            </div>
          </div>

          <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
            <div style={{ fontSize: z(15), fontWeight: 800, letterSpacing: "0.04em" }}>Tax Invoice</div>
            <div style={{ marginTop: z(3) }}>Invoice No: {invoice.invoiceNumber}</div>
            {pat.showInvoiceDate && (
              <div>Date: {format(new Date(invoice.createdAt), "dd-MM-yyyy")}</div>
            )}
            {pat.showPlaceOfSupply && placeOfSupply && (
              <div>Place of Supply: {placeOfSupply}</div>
            )}
          </div>
        </div>

        <div style={{ borderBottom: `3px solid ${primary}`, margin: `${z(8)} 0 ${z(10)}` }} />

        {/* ── Bill To / Wholesale Details ────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", ...box, padding: 0, marginBottom: z(10) }}>
          <div style={{ padding: `${z(8)} ${z(10)}`, borderRight: "1px solid #9ca3af" }}>
            <div style={boxTitle}>Bill To</div>
            {pat.showName && <div>{invoice.customerName || "Walk-in Customer"}</div>}
            {pat.showMobile   && invoice.customerPhone   && <div>Phone: {invoice.customerPhone}</div>}
            {pat.showAddress  && invoice.customerAddress && <div>{invoice.customerAddress}</div>}
            {pat.showBuyerGstin                          && <div>GSTIN: {invoice.buyerGstin || "N/A"}</div>}
            {pat.showUhid     && invoice.uhid            && <div>UHID: {invoice.uhid}</div>}
            {pat.showAbha     && invoice.abha            && <div>ABHA: {invoice.abha}</div>}
            {pat.showDoctor   && invoice.doctorName      && (
              <div>Doctor: {invoice.doctorName}{invoice.doctorRegNo ? ` (Reg: ${invoice.doctorRegNo})` : ""}</div>
            )}
            {pat.showPrescriptionNo && invoice.prescriptionNo && <div>Rx No: {invoice.prescriptionNo}</div>}
          </div>
          <div style={{ padding: `${z(8)} ${z(10)}` }}>
            {pat.showBuyerGstin && invoice.buyerGstin ? (
              <>
                <div style={boxTitle}>Wholesale Details</div>
                <div>Buyer GSTIN: {invoice.buyerGstin}</div>
                {placeOfSupply && <div>Place of Supply: {placeOfSupply}</div>}
                {rightBoxRows}
              </>
            ) : (
              <>
                <div style={boxTitle}>Invoice Details</div>
                {rightBoxRows.length > 0 ? rightBoxRows : <div style={{ color: "#9ca3af" }}>—</div>}
              </>
            )}
          </div>
        </div>

        {/* ── Items grid ────────────────────────────────────────────────────── */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: z(10) }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={{ ...th, textAlign: c.align, width: c.width }}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((it, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} style={td(c.align)}>{c.cell(it, i)}</td>
                ))}
              </tr>
            ))}
            {Array.from({ length: blankRows }).map((_, i) => (
              <tr key={`blank-${i}`}>
                {columns.map((c) => (
                  <td key={c.key} style={td(c.align)}>&nbsp;</td>
                ))}
              </tr>
            ))}
            <tr>
              <td colSpan={firstTotalIdx} style={{ ...td("right"), fontWeight: 700, background: "#f9fafb" }}>
                Column Totals
              </td>
              {columns.slice(firstTotalIdx).map((c) => (
                <td key={c.key} style={{ ...td(c.align), fontWeight: 700, background: "#f9fafb" }}>
                  {c.total !== undefined ? c.total.toFixed(2) : ""}
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        {/* ── Footer band: Bank / GST Summary / Totals ───────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: z(10), marginBottom: z(10) }}>

          {/* Bank Details + UPI QR */}
          <div style={box}>
            {bank.show && (
              <>
                <div style={boxTitle}>Bank Details</div>
                {bank.bankName      && <div>Bank: {bank.bankName}</div>}
                {bank.accountNumber && <div>A/C No: {bank.accountNumber}</div>}
                {bank.ifsc          && <div>IFSC: {bank.ifsc}</div>}
                {bank.branch        && <div>Branch: {bank.branch}</div>}
              </>
            )}
            {upiUri && (
              <div style={{ textAlign: "center", marginTop: bank.show ? z(8) : 0 }}>
                <QRCodeSVG value={upiUri} size={Math.round(96 * scale)} level="M" marginSize={1} />
                <div style={{ marginTop: z(2) }}>UPI ID: {ftr.upiId}</div>
              </div>
            )}
            {!bank.show && !upiUri && (
              <div style={{ color: "#9ca3af" }}>Bank details not configured</div>
            )}
          </div>

          {/* GST Summary */}
          <div style={box}>
            <div style={{ ...boxTitle, marginBottom: z(4) }}>GST Summary</div>
            {tot.showGstBreakdown && Object.entries(slabs).sort(([a], [b]) => Number(a) - Number(b)).map(([rate, v]) => (
              <div key={rate} style={labelVal}>
                <span>{rate}% on {v.taxable.toFixed(2)}</span>
                <span>{isInterstate ? v.igst.toFixed(2) : (v.cgst + v.sgst).toFixed(2)}</span>
              </div>
            ))}
            <div style={{ borderTop: "1px solid #d1d5db", marginTop: z(4), paddingTop: z(2) }}>
              {showCgstRow && <div style={labelVal}><span>CGST</span><span>{invoice.cgst.toFixed(2)}</span></div>}
              {showSgstRow && <div style={labelVal}><span>SGST</span><span>{invoice.sgst.toFixed(2)}</span></div>}
              {showIgstRow && <div style={labelVal}><span>IGST</span><span>{invoice.igst.toFixed(2)}</span></div>}
              <div style={{ ...labelVal, fontWeight: 700 }}>
                <span>GST Total</span><span>{invoice.totalGst.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Totals */}
          <div style={box}>
            {totalRows}
            <div style={{ ...labelVal, fontWeight: 800, borderTop: `2px solid ${primary}`, marginTop: z(3), paddingTop: z(3) }}>
              <span>Rounded Total</span><span>{formatCurrency(roundedTotal)}</span>
            </div>
            {tot.showAmountWords && (
              <div style={{ marginTop: z(4), fontSize: z(9) }}>
                <strong>Amount in Words: </strong>{formatAmountInWords(roundedTotal)}
              </div>
            )}
          </div>
        </div>

        {/* ── Terms + Signature ─────────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: z(10) }}>
          <div style={box}>
            <div style={boxTitle}>Terms &amp; Conditions</div>
            {(ftr.terms || "").split("\n").filter(Boolean).map((t, i) => (
              <div key={i}>{i + 1}. {t}</div>
            ))}
            {ftr.contactInfo && <div style={{ marginTop: z(4), color: "#4b5563" }}>{ftr.contactInfo}</div>}
          </div>
          {ftr.showSignature && (
            <div style={{ ...box, borderStyle: "dashed", display: "flex", flexDirection: "column",
              alignItems: "flex-end", justifyContent: "flex-end", color: "#6b7280" }}>
              <div style={{ marginTop: z(28) }}>For {displayName}</div>
              <div>{ftr.signatureLabel || "Authorized Signature"}</div>
            </div>
          )}
        </div>

        {ftr.thankYouText && (
          <div style={{ textAlign: "center", marginTop: z(8), fontStyle: "italic", color: "#6b7280" }}>
            {ftr.thankYouText}
          </div>
        )}
        <div style={{ textAlign: "center", marginTop: z(6), fontSize: z(8), color: "#9ca3af" }}>
          This is a computer-generated invoice.
        </div>
      </div>
    );
  },
);
