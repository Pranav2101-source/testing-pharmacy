"use client";
import { forwardRef } from "react";
import { format } from "date-fns";
import { formatCurrency, formatAmountInWords } from "@pharmacy/utils";
import { normalizeInvoiceSettings } from "@pharmacy/types";
import type { InvoiceSettingsConfig } from "@pharmacy/types";
import { QRCodeSVG } from "qrcode.react";
import { buildUpiUri } from "@/lib/upiQr";
import { formatPaymentLine } from "./InvoicePrintView";
import type { PrintInvoiceData, PharmacyProfile } from "./InvoicePrintView";

// ─── A5 Half-Sheet (landscape) invoice ────────────────────────────────────────
// 210 × 148 mm — half of an A4, so two bills fit one folded A4 sheet. Same GST
// tax-invoice content as TaxWholesaleInvoiceView (bordered item grid, "Column
// Totals", optional Buyer-GSTIN block, Bank / GST / Totals footer band, terms +
// signature) squeezed to the half sheet: 8px type, MIN_ROWS = 5, fixed height
// with overflow clipped rather than paginated.
//
// Selected via `paper.size === "A5"` (see lib/invoiceRenderer.ts). Honours the
// SAME content toggles as the other two page formats. `paper.marginMm` overrides
// the 4 mm default page margin (clamped 2–10 for this sheet); `paper.contentScale`
// scales every size together.
//
// Prints on the right sheet regardless of the OS dialog default via an injected
// `@page { size: 210mm 148mm }` — suppressed in the settings-screen preview
// (`preview` prop) so it does not hijack Ctrl+P on that page.

type Item = PrintInvoiceData["items"][number];

const clamp = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;

/** Blank rows keep the grid a constant height on the half sheet. */
const MIN_ROWS = 5;

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
  /** Settings-screen live preview — skip the injected @page rule. */
  preview?:  boolean;
};

export const A5LandscapeInvoiceView = forwardRef<HTMLDivElement, Props>(
  function A5LandscapeInvoiceView({ invoice, config: configProp, pharmacy: pharmacyProp, preview }, ref) {
    const cfg      = normalizeInvoiceSettings(configProp);
    const pharmacy = pharmacyProp ?? PREVIEW_PHARMACY;

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

    const marginMm = clamp(cfg.paper.marginMm ?? 4, 2, 10);
    const scale    = clamp(cfg.paper.contentScale ?? 1, 0.8, 1.15);
    const minRows  = Math.round(clamp(cfg.paper.minRows ?? MIN_ROWS, 0, 12));
    const z = (px: number) => `${+(px * scale).toFixed(2)}px`;

    const primary       = br.primaryColor || "#111827";
    const displayName   = br.pharmacyNameOverride || pharmacy.name;
    const isInterstate  = invoice.isInterstate ?? false;
    const placeOfSupply = invoice.placeOfSupply || pharmacy.state || "";

    const extraCharges  = invoice.extraCharges ?? 0;
    const adjustment    = invoice.adjustmentAmount ?? 0;
    const taxAndCharges = invoice.taxableAmount + invoice.totalGst + extraCharges + adjustment;
    const roundOff      = invoice.roundOff ?? (Math.round(taxAndCharges) - taxAndCharges);
    const roundedTotal  = Math.round(taxAndCharges + roundOff);

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
    const sum = (f: (it: Item) => number) => invoice.items.reduce((a, it) => a + f(it), 0);

    type Column = {
      key: string; header: string; align: "left" | "center" | "right";
      cell: (it: Item, i: number) => React.ReactNode; total?: number; width?: string;
    };
    const columns: Column[] = [
      { key: "sn", header: "#", align: "center", width: z(20), cell: (_it, i) => i + 1 },
      { key: "name", header: "Item", align: "left", cell: (it) => (
          <>{it.medicineName}{it.saleUnit === "LOOSE" && <span style={{ color: "#a16207" }}> ·loose</span>}</>
        ) },
      ...(col.showHsn ? [{ key: "hsn", header: "HSN", align: "left" as const, width: z(40),
        cell: (it: Item) => it.hsnCode || "—" }] : []),
      ...(col.showBatch ? [{ key: "batch", header: "Batch", align: "left" as const, width: z(46),
        cell: (it: Item) => it.batchNumber }] : []),
      ...(col.showExpiry ? [{ key: "exp", header: "Exp", align: "center" as const, width: z(34),
        cell: (it: Item) => format(new Date(it.expiryDate), "MM/yy") }] : []),
      ...(col.showMrp ? [{ key: "mrp", header: "MRP", align: "right" as const, width: z(42),
        cell: (it: Item) => it.mrp.toFixed(2) }] : []),
      ...(col.showRate ? [{ key: "rate", header: "Rate", align: "right" as const, width: z(42),
        cell: (it: Item) => it.rate.toFixed(2) }] : []),
      { key: "qty", header: "Qty", align: "right", width: z(30), cell: (it: Item) => it.quantity },
      ...(col.showFreeQty ? [{ key: "free", header: "Free", align: "right" as const, width: z(30),
        cell: (it: Item) => (it.freeQty ? it.freeQty : "0"), total: sum((it) => it.freeQty ?? 0) }] : []),
      ...(col.showDiscount ? [{ key: "disc", header: "Disc", align: "right" as const, width: z(32),
        cell: (it: Item) => (it.discount > 0 ? `${it.discount}%` : "0") }] : []),
      ...(col.showGstRate && !isInterstate ? [
        { key: "cgst", header: "CGST", align: "right" as const, width: z(40),
          cell: (it: Item) => it.cgst.toFixed(2), total: sum((it) => it.cgst) },
        { key: "sgst", header: "SGST", align: "right" as const, width: z(40),
          cell: (it: Item) => it.sgst.toFixed(2), total: sum((it) => it.sgst) },
      ] : []),
      ...(col.showGstRate && isInterstate ? [
        { key: "igst", header: "IGST", align: "right" as const, width: z(46),
          cell: (it: Item) => igstOf(it).toFixed(2), total: sum(igstOf) },
      ] : []),
      { key: "total", header: "Total", align: "right", width: z(50),
        cell: (it: Item) => it.amount.toFixed(2), total: sum((it) => it.amount) },
    ];
    const firstTotalIdx = columns.findIndex((c) => c.total !== undefined);
    const blankRows = Math.max(0, minRows - invoice.items.length);

    // ── Style tokens ─────────────────────────────────────────────────────────
    const paperStyle: React.CSSProperties = {
      width: "210mm", height: "148mm", maxHeight: "148mm", padding: `${marginMm}mm`,
      overflow: "hidden", boxSizing: "border-box",
      pageBreakInside: "avoid", breakInside: "avoid",
      background: "#fff", color: "#111827", fontSize: z(8),
      fontFamily: "Arial, Helvetica, sans-serif", lineHeight: 1.28,
    };
    const boxStyle: React.CSSProperties = { border: "1px solid #9ca3af", padding: `${z(4)} ${z(5)}` };
    const th: React.CSSProperties = {
      border: "1px solid #6b7280", padding: `${z(2)} ${z(3)}`, fontWeight: 700,
      background: "#f3f4f6", whiteSpace: "nowrap", fontSize: z(7.5),
    };
    const td = (align: "left" | "center" | "right"): React.CSSProperties => ({
      border: "1px solid #9ca3af", padding: `${z(1.5)} ${z(3)}`, textAlign: align, whiteSpace: "nowrap",
    });
    const lv: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: z(6), padding: `${z(1)} 0` };
    const boxTitle: React.CSSProperties = { fontWeight: 700, marginBottom: z(2) };

    // ── Financial Summary rows (toggleable ones gated; GST-locked always show) ──
    const totalRows: React.ReactNode[] = [];
    if (tot.showSubtotal)
      totalRows.push(<div key="sub" style={lv}><span>Subtotal (MRP)</span><span>{invoice.subtotal.toFixed(2)}</span></div>);
    if (tot.showDiscount && invoice.discountAmount > 0)
      totalRows.push(<div key="disc" style={{ ...lv, color: "#15803d" }}><span>Discount</span><span>− {invoice.discountAmount.toFixed(2)}</span></div>);
    if (tot.showSavings && invoice.discountAmount > 0)
      totalRows.push(<div key="save" style={{ ...lv, color: "#15803d" }}><span>You Save</span><span>{invoice.discountAmount.toFixed(2)}</span></div>);
    if (tot.showTaxable)
      totalRows.push(<div key="tax" style={lv}><span>Taxable</span><span>{invoice.taxableAmount.toFixed(2)}</span></div>);
    if (extraCharges > 0)
      totalRows.push(<div key="extra" style={lv}><span>Extra Charges</span><span>{extraCharges.toFixed(2)}</span></div>);
    if (Math.abs(adjustment) >= 0.005)
      totalRows.push(<div key="adj" style={lv}><span>Adjustment</span><span>{adjustment > 0 ? "+" : "−"}{Math.abs(adjustment).toFixed(2)}</span></div>);
    totalRows.push(<div key="grand" style={lv}><span>Grand Total</span><span>{taxAndCharges.toFixed(2)}</span></div>);
    if (tot.showRoundOff && Math.abs(roundOff) >= 0.005)
      totalRows.push(<div key="round" style={{ ...lv, color: "#6b7280" }}><span>Round Off</span><span>{roundOff > 0 ? "+" : "−"}{Math.abs(roundOff).toFixed(2)}</span></div>);

    const showCgstRow = !isInterstate && tot.showCgst;
    const showSgstRow = !isInterstate && tot.showSgst;
    const showIgstRow = isInterstate && tot.showIgst;

    return (
      <div ref={ref} style={paperStyle}>
        {!preview && <style>{`@page { size: 210mm 148mm; margin: 0; }`}</style>}

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: z(10) }}>
          <div style={{ textAlign: hdr.align, maxWidth: "62%" }}>
            {br.showLogo && br.logoUrl && (
              <img src={br.logoUrl} alt="logo" style={{ maxHeight: z(28), objectFit: "contain", marginBottom: z(2) }} />
            )}
            {hdr.showName && (
              <div style={{
                fontSize: z(12), color: primary,
                fontWeight: br.pharmacyNameStyle === "bold" ? 800 : br.pharmacyNameStyle === "italic" ? 500 : 700,
                fontStyle: br.pharmacyNameStyle === "italic" ? "italic" : "normal",
              }}>{displayName}</div>
            )}
            {hdr.showAddress && pharmacy.address && <div style={{ color: "#4b5563" }}>{pharmacy.address}</div>}
            <div style={{ color: "#4b5563" }}>
              {[
                hdr.showGstin && pharmacy.gstin ? `GSTIN: ${pharmacy.gstin}` : null,
                hdr.showDrugLicense && pharmacy.drugLicense ? `DL: ${pharmacy.drugLicense}` : null,
                hdr.showFssai && pharmacy.fssai ? `FSSAI: ${pharmacy.fssai}` : null,
              ].filter(Boolean).join("  |  ")}
            </div>
            <div style={{ color: "#4b5563" }}>
              {[
                hdr.showPhone && pharmacy.phone ? `Ph: ${pharmacy.phone}` : null,
                hdr.showEmail && pharmacy.email ? pharmacy.email : null,
                hdr.showWebsite && pharmacy.website ? pharmacy.website : null,
              ].filter(Boolean).join("  |  ")}
            </div>
            {hdr.customText && <div style={{ color: "#6b7280" }}>{hdr.customText}</div>}
          </div>

          <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
            <div style={{ fontSize: z(11), fontWeight: 800, letterSpacing: "0.03em" }}>TAX INVOICE</div>
            <div>Invoice No: {invoice.invoiceNumber}</div>
            {pat.showInvoiceDate && <div>Date: {format(new Date(invoice.createdAt), "dd-MM-yyyy")}</div>}
            {pat.showPlaceOfSupply && placeOfSupply && <div>Place of Supply: {placeOfSupply}</div>}
          </div>
        </div>

        <div style={{ borderBottom: `2px solid ${primary}`, margin: `${z(4)} 0 ${z(5)}` }} />

        {/* ── Bill To / Wholesale Details ────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", ...boxStyle, padding: 0, marginBottom: z(5) }}>
          <div style={{ padding: `${z(3)} ${z(5)}`, borderRight: "1px solid #9ca3af" }}>
            <span style={{ fontWeight: 700 }}>Bill To: </span>
            {pat.showName && <span>{invoice.customerName || "Walk-in Customer"}</span>}
            {pat.showMobile && invoice.customerPhone && <span> · {invoice.customerPhone}</span>}
            {pat.showBuyerGstin && <span> · GSTIN: {invoice.buyerGstin || "N/A"}</span>}
            {pat.showAddress && invoice.customerAddress && <div>{invoice.customerAddress}</div>}
            {pat.showUhid && invoice.uhid && <span> · UHID: {invoice.uhid}</span>}
            {pat.showAbha && invoice.abha && <span> · ABHA: {invoice.abha}</span>}
            {pat.showDoctor && invoice.doctorName && (
              <div>Dr. {invoice.doctorName}{invoice.doctorRegNo ? ` (${invoice.doctorRegNo})` : ""}</div>
            )}
            {pat.showPrescriptionNo && invoice.prescriptionNo && <span> · Rx: {invoice.prescriptionNo}</span>}
          </div>
          <div style={{ padding: `${z(3)} ${z(5)}` }}>
            {pat.showBuyerGstin && invoice.buyerGstin ? (
              <>
                <span style={{ fontWeight: 700 }}>Wholesale: </span>
                <span>Buyer GSTIN {invoice.buyerGstin}</span>
                {placeOfSupply && <span> · {placeOfSupply}</span>}
              </>
            ) : (
              <>
                {tot.showPaymentMode && <div>Payment: {formatPaymentLine(invoice)}</div>}
                {pat.showCashier && invoice.cashierName && <div>Cashier: {invoice.cashierName}</div>}
              </>
            )}
          </div>
        </div>

        {/* ── Items grid ────────────────────────────────────────────────────── */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: z(5), fontSize: z(7.5) }}>
          <thead>
            <tr>{columns.map((c) => (
              <th key={c.key} style={{ ...th, textAlign: c.align, width: c.width }}>{c.header}</th>
            ))}</tr>
          </thead>
          <tbody>
            {invoice.items.map((it, i) => (
              <tr key={i}>{columns.map((c) => <td key={c.key} style={td(c.align)}>{c.cell(it, i)}</td>)}</tr>
            ))}
            {Array.from({ length: blankRows }).map((_, i) => (
              <tr key={`b-${i}`}>{columns.map((c) => <td key={c.key} style={td(c.align)}>&nbsp;</td>)}</tr>
            ))}
            <tr>
              <td colSpan={firstTotalIdx} style={{ ...td("right"), fontWeight: 700, background: "#f9fafb" }}>Column Totals</td>
              {columns.slice(firstTotalIdx).map((c) => (
                <td key={c.key} style={{ ...td(c.align), fontWeight: 700, background: "#f9fafb" }}>
                  {c.total !== undefined ? c.total.toFixed(2) : ""}
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        {/* ── Footer band: Bank / GST Summary / Totals ───────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: z(6), marginBottom: z(4) }}>
          <div style={boxStyle}>
            {bank.show && (
              <>
                <div style={boxTitle}>Bank Details</div>
                {bank.bankName      && <div>Bank: {bank.bankName}</div>}
                {bank.accountNumber && <div>A/C: {bank.accountNumber}</div>}
                {bank.ifsc          && <div>IFSC: {bank.ifsc}</div>}
                {bank.branch        && <div>Br: {bank.branch}</div>}
              </>
            )}
            {upiUri && (
              <div style={{ textAlign: "center", marginTop: bank.show ? z(4) : 0 }}>
                <QRCodeSVG value={upiUri} size={Math.round(56 * scale)} level="M" marginSize={1} />
                <div>UPI: {ftr.upiId}</div>
              </div>
            )}
            {!bank.show && !upiUri && <div style={{ color: "#9ca3af" }}>Bank details not configured</div>}
          </div>

          <div style={boxStyle}>
            <div style={{ ...boxTitle, marginBottom: z(3) }}>GST Summary</div>
            {tot.showGstBreakdown && Object.entries(slabs).sort(([a], [b]) => Number(a) - Number(b)).map(([rate, v]) => (
              <div key={rate} style={lv}>
                <span>{rate}% on {v.taxable.toFixed(2)}</span>
                <span>{isInterstate ? v.igst.toFixed(2) : (v.cgst + v.sgst).toFixed(2)}</span>
              </div>
            ))}
            <div style={{ borderTop: "1px solid #d1d5db", marginTop: z(3), paddingTop: z(1) }}>
              {showCgstRow && <div style={lv}><span>CGST</span><span>{invoice.cgst.toFixed(2)}</span></div>}
              {showSgstRow && <div style={lv}><span>SGST</span><span>{invoice.sgst.toFixed(2)}</span></div>}
              {showIgstRow && <div style={lv}><span>IGST</span><span>{invoice.igst.toFixed(2)}</span></div>}
              <div style={{ ...lv, fontWeight: 700 }}><span>GST Total</span><span>{invoice.totalGst.toFixed(2)}</span></div>
            </div>
          </div>

          <div style={boxStyle}>
            {totalRows}
            <div style={{ ...lv, fontWeight: 800, borderTop: `2px solid ${primary}`, marginTop: z(2), paddingTop: z(2) }}>
              <span>Rounded Total</span><span>{formatCurrency(roundedTotal)}</span>
            </div>
            {tot.showAmountWords && (
              <div style={{ marginTop: z(2) }}><strong>In words: </strong>{formatAmountInWords(roundedTotal)}</div>
            )}
          </div>
        </div>

        {/* ── Terms + Signature ─────────────────────────────────────────────── */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: z(10), alignItems: "flex-end" }}>
          <div style={{ maxWidth: "68%", color: "#4b5563" }}>
            {(ftr.terms || "").split("\n").filter(Boolean).slice(0, 3).map((t, i) => (
              <span key={i}>{i > 0 ? " · " : ""}{t}</span>
            ))}
          </div>
          {ftr.showSignature && (
            <div style={{ textAlign: "right", color: "#6b7280" }}>
              <div style={{ marginTop: z(12) }}>For {displayName}</div>
              <div>{ftr.signatureLabel || "Authorized Signature"}</div>
            </div>
          )}
        </div>

        {ftr.thankYouText && (
          <div style={{ textAlign: "center", marginTop: z(3), fontStyle: "italic", color: "#6b7280" }}>
            {ftr.thankYouText}
          </div>
        )}
      </div>
    );
  },
);
