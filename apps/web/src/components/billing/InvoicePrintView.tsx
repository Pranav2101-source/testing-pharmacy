"use client";
import { forwardRef } from "react";
import { format } from "date-fns";
import { formatCurrency, formatAmountInWords } from "@pharmacy/utils";
import { defaultInvoiceSettings, normalizeInvoiceSettings } from "@pharmacy/types";
import type { InvoiceSettingsConfig } from "@pharmacy/types";

// ─── Data shape ───────────────────────────────────────────────────────────────

export type PrintInvoiceData = {
  invoiceNumber:    string;
  createdAt:        string;
  customerName?:    string;
  customerPhone?:   string;
  customerAddress?: string;
  uhid?:            string;
  abha?:            string;
  prescriptionNo?:  string;
  doctorName?:      string;
  doctorRegNo?:     string;
  paymentMode:      string;
  paymentStatus:    string;
  isInterstate?:    boolean;
  cashierName?:     string;
  items: Array<{
    medicineName:  string;
    hsnCode:       string | null;
    batchNumber:   string;
    expiryDate:    string;
    mrp:           number;
    quantity:      number;
    /** Scheme quantity given free (10+1). Not charged; still dispensed. 0/absent when none. */
    freeQty?:      number;
    discount:      number;
    gstRate:       number;
    rate:          number;
    taxableAmount: number;
    cgst:          number;
    sgst:          number;
    igst:          number;
    amount:        number;
  }>;
  subtotal:       number;
  discountAmount: number;
  taxableAmount:  number;
  cgst:           number;
  sgst:           number;
  igst:           number;
  totalGst:       number;
  totalAmount:    number;
};

// Pharmacy info passed down from the session context (or omitted for mock preview)
export type PharmacyProfile = {
  name:        string;
  address?:    string;
  phone?:      string;
  email?:      string;
  website?:    string;
  gstin?:      string;
  drugLicense?: string;
  fssai?:      string;
};

type Props = {
  invoice:  PrintInvoiceData;
  config?:  Partial<InvoiceSettingsConfig>;
  pharmacy?: PharmacyProfile;
};

// ─── Mock pharmacy used in the live preview ───────────────────────────────────

const PREVIEW_PHARMACY: PharmacyProfile = {
  name:        "Checkup Pharmacy",
  address:     "123 MG Road, Andheri West, Mumbai 400058",
  phone:       "+91 98765 43210",
  email:       "info@checkuppharmacy.com",
  gstin:       "27ABCDE1234F1Z5",
  drugLicense: "MH-MUM-1234",
  fssai:       "11224567890123",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Normalisation lives in @pharmacy/types. This file used to carry its own copy
// which merged defaults but did NOT re-assert the GST-mandatory fields — and this
// is the component that renders the actual bill, so a stored config with
// `showHsn: false` would have printed a non-compliant invoice while the settings
// screen showed that toggle locked on.

// ─── Component ────────────────────────────────────────────────────────────────

export const InvoicePrintView = forwardRef<HTMLDivElement, Props>(
  function InvoicePrintView({ invoice, config: configProp, pharmacy: pharmacyProp }, ref) {
    const cfg      = normalizeInvoiceSettings(configProp);
    const pharmacy = pharmacyProp ?? PREVIEW_PHARMACY;
    const col      = cfg.columns;
    const tot      = cfg.totals;
    const hdr      = cfg.header;
    const pat      = cfg.patient;
    const ftr      = cfg.footer;
    const br       = cfg.branding;

    const primary      = br.primaryColor || "#1a3080";
    const displayName  = br.pharmacyNameOverride || pharmacy.name;
    const roundedTotal = Math.round(invoice.totalAmount);
    const roundOff     = roundedTotal - invoice.totalAmount;
    const isInterstate = invoice.isInterstate ?? false;

    // Determine which GST columns to show
    const showCgstCol = !isInterstate && col.showGstRate;
    const showIgstCol =  isInterstate && col.showGstRate;

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

    // Paper size → pixel width
    const paperStyle: React.CSSProperties =
      cfg.paper.size === "A5"
        ? { width: "148mm", minHeight: "210mm", padding: "8mm",  fontSize: "9px"  }
        : { width: "210mm", minHeight: "297mm", padding: "10mm", fontSize: "10px" };

    const thStyle: React.CSSProperties = {
      padding: "5px 6px",
      fontWeight: 600,
      whiteSpace: "nowrap" as const,
      color: "#fff",
      background: primary,
    };

    const tdStyle = (right = false): React.CSSProperties => ({
      padding: "4px 6px",
      borderBottom: "1px solid #eee",
      textAlign: right ? "right" : "left",
    });

    return (
      <div
        ref={ref}
        className="bg-white font-sans text-gray-900 relative"
        style={{ ...paperStyle, lineHeight: "1.4" }}
      >
        {/* Watermark */}
        {br.watermarkText && (
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%,-50%) rotate(-45deg)",
            fontSize: "48px", fontWeight: 900, opacity: 0.06,
            color: primary, pointerEvents: "none", userSelect: "none",
            whiteSpace: "nowrap", zIndex: 0,
          }}>
            {br.watermarkText}
          </div>
        )}

        <div style={{ position: "relative", zIndex: 1 }}>

          {/* ── Header ────────────────────────────────────────────────────────── */}
          <div style={{
            borderBottom: `2px solid ${primary}`,
            paddingBottom: "10px",
            marginBottom: "12px",
            textAlign: hdr.align,
            display: "flex",
            flexDirection: "column",
            alignItems: hdr.align === "center" ? "center" : hdr.align === "right" ? "flex-end" : "flex-start",
          }}>
            {br.showLogo && br.logoUrl && (
              <img
                src={br.logoUrl}
                alt="logo"
                style={{
                  height: br.logoSize === "small" ? "36px" : br.logoSize === "large" ? "72px" : "52px",
                  marginBottom: "6px",
                  objectFit: "contain",
                  // The logo has its own Position control, separate from the header's
                  // alignment. Without alignSelf it inherited the parent's alignItems
                  // (i.e. header.align) and the Position setting did nothing at all.
                  alignSelf: br.logoPosition === "center" ? "center"
                           : br.logoPosition === "right"  ? "flex-end"
                           : "flex-start",
                }}
              />
            )}

            {hdr.showName && (
              <h1 style={{
                fontSize: cfg.paper.size === "A5" ? "16px" : "20px",
                fontWeight: br.pharmacyNameStyle === "bold" ? 700 : br.pharmacyNameStyle === "italic" ? 400 : 600,
                fontStyle: br.pharmacyNameStyle === "italic" ? "italic" : "normal",
                margin: 0,
                color: primary,
              }}>
                {displayName}
              </h1>
            )}
            {hdr.showAddress && pharmacy.address && (
              <p style={{ color: "#555", margin: "3px 0 2px", fontSize: "9px" }}>{pharmacy.address}</p>
            )}
            <div style={{ fontSize: "9px", color: "#555", margin: "2px 0" }}>
              {hdr.showPhone       && pharmacy.phone       && <span>{pharmacy.phone}</span>}
              {hdr.showPhone && hdr.showEmail && pharmacy.phone && pharmacy.email && <span> · </span>}
              {hdr.showEmail       && pharmacy.email       && <span>{pharmacy.email}</span>}
              {hdr.showWebsite     && pharmacy.website     && <span> · {pharmacy.website}</span>}
            </div>
            <div style={{ fontSize: "9px", color: "#555", margin: "2px 0" }}>
              {hdr.showGstin       && pharmacy.gstin       && <span>GSTIN: {pharmacy.gstin}</span>}
              {hdr.showGstin && hdr.showDrugLicense && pharmacy.gstin && pharmacy.drugLicense && <span> · </span>}
              {hdr.showDrugLicense && pharmacy.drugLicense && <span>Drug Lic: {pharmacy.drugLicense}</span>}
              {hdr.showFssai       && pharmacy.fssai       && <span> · FSSAI: {pharmacy.fssai}</span>}
            </div>
            {hdr.customText && (
              <p style={{ fontSize: "8.5px", color: "#777", marginTop: "3px" }}>{hdr.customText}</p>
            )}
            <div style={{
              display: "inline-block", background: primary, color: "#fff",
              padding: "2px 14px", borderRadius: "4px", marginTop: "8px",
              fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em",
            }}>
              TAX INVOICE
            </div>
          </div>

          {/* ── Invoice meta + Patient info ───────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "12px" }}>
            <div style={{ lineHeight: "1.8", fontSize: "9.5px" }}>
              <p><strong>Invoice No:</strong> {invoice.invoiceNumber}</p>
              {pat.showInvoiceDate && (
                <p><strong>Date:</strong> {format(new Date(invoice.createdAt), "dd/MM/yyyy HH:mm")}</p>
              )}
              {tot.showPaymentMode && (
                <p><strong>Payment:</strong> {invoice.paymentMode} — {invoice.paymentStatus}</p>
              )}
              {pat.showCashier && invoice.cashierName && (
                <p><strong>Cashier:</strong> {invoice.cashierName}</p>
              )}
            </div>
            <div style={{ lineHeight: "1.8", fontSize: "9.5px" }}>
              {pat.showName           && invoice.customerName    && <p><strong>Patient:</strong>    {invoice.customerName}</p>}
              {pat.showMobile         && invoice.customerPhone   && <p><strong>Phone:</strong>      {invoice.customerPhone}</p>}
              {pat.showAddress        && invoice.customerAddress && <p><strong>Address:</strong>    {invoice.customerAddress}</p>}
              {pat.showUhid           && invoice.uhid            && <p><strong>UHID:</strong>       {invoice.uhid}</p>}
              {pat.showAbha           && invoice.abha            && <p><strong>ABHA:</strong>       {invoice.abha}</p>}
              {pat.showDoctor         && invoice.doctorName      && <p><strong>Doctor:</strong>     {invoice.doctorName}{invoice.doctorRegNo ? ` (Reg: ${invoice.doctorRegNo})` : ""}</p>}
              {pat.showPrescriptionNo && invoice.prescriptionNo  && <p><strong>Rx No:</strong>      {invoice.prescriptionNo}</p>}
            </div>
          </div>

          {/* ── Items table ──────────────────────────────────────────────────── */}
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "14px", fontSize: "9px" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: "center" }}>#</th>
                <th style={{ ...thStyle, textAlign: "left" }}>Medicine</th>
                {col.showHsn      && <th style={{ ...thStyle, textAlign: "left" }}>HSN</th>}
                {col.showBatch    && <th style={{ ...thStyle, textAlign: "left" }}>Batch</th>}
                {col.showExpiry   && <th style={{ ...thStyle, textAlign: "left" }}>Exp</th>}
                {col.showMrp      && <th style={{ ...thStyle, textAlign: "right" }}>MRP</th>}
                <th style={{ ...thStyle, textAlign: "center" }}>Qty</th>
                {col.showFreeQty  && <th style={{ ...thStyle, textAlign: "center" }}>Free</th>}
                {col.showDiscount && <th style={{ ...thStyle, textAlign: "right" }}>Disc%</th>}
                {col.showRate     && <th style={{ ...thStyle, textAlign: "right" }}>Rate</th>}
                {col.showTaxable  && <th style={{ ...thStyle, textAlign: "right" }}>Taxable</th>}
                {col.showGstRate  && <th style={{ ...thStyle, textAlign: "center" }}>GST%</th>}
                {showCgstCol && <th style={{ ...thStyle, textAlign: "right" }}>CGST</th>}
                {showCgstCol && <th style={{ ...thStyle, textAlign: "right" }}>SGST</th>}
                {showIgstCol && <th style={{ ...thStyle, textAlign: "right" }}>IGST</th>}
                <th style={{ ...thStyle, textAlign: "right" }}>Amt</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f9f9f9" }}>
                  <td style={{ ...tdStyle(), textAlign: "center" }}>{i + 1}</td>
                  <td style={{ ...tdStyle(), fontWeight: 500 }}>{item.medicineName}</td>
                  {col.showHsn      && <td style={tdStyle()}>{item.hsnCode || "—"}</td>}
                  {col.showBatch    && <td style={{ ...tdStyle(), fontFamily: "monospace" }}>{item.batchNumber}</td>}
                  {col.showExpiry   && <td style={{ ...tdStyle(), whiteSpace: "nowrap" }}>{format(new Date(item.expiryDate), "MM/yy")}</td>}
                  {col.showMrp      && <td style={tdStyle(true)}>₹{item.mrp.toFixed(2)}</td>}
                  <td style={{ ...tdStyle(), textAlign: "center" }}>{item.quantity}</td>
                  {/* Real scheme quantity. Blank-dashed when the line has none, so a
                      10+1 row stands out against ordinary ones. */}
                  {col.showFreeQty  && <td style={{ ...tdStyle(), textAlign: "center" }}>{item.freeQty ? item.freeQty : "—"}</td>}
                  {col.showDiscount && <td style={tdStyle(true)}>{item.discount > 0 ? `${item.discount}%` : "—"}</td>}
                  {col.showRate     && <td style={tdStyle(true)}>₹{item.rate.toFixed(2)}</td>}
                  {col.showTaxable  && <td style={tdStyle(true)}>₹{item.taxableAmount.toFixed(2)}</td>}
                  {col.showGstRate  && <td style={{ ...tdStyle(), textAlign: "center" }}>{item.gstRate}%</td>}
                  {showCgstCol && <td style={tdStyle(true)}>₹{item.cgst.toFixed(2)}</td>}
                  {showCgstCol && <td style={tdStyle(true)}>₹{item.sgst.toFixed(2)}</td>}
                  {showIgstCol && <td style={tdStyle(true)}>₹{(item.igst || item.cgst + item.sgst).toFixed(2)}</td>}
                  <td style={{ ...tdStyle(true), fontWeight: 600 }}>₹{item.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* ── Totals + GST slab ────────────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "12px" }}>
            {/* GST slab breakdown */}
            {tot.showGstBreakdown && (
              <div>
                <p style={{ fontWeight: 600, marginBottom: "6px", color: "#333", fontSize: "9.5px" }}>GST Summary</p>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9px", border: "1px solid #ccc" }}>
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
                    {Object.entries(slabs).sort(([a], [b]) => Number(a) - Number(b)).map(([rate, v]) => (
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
            )}

            {/* Invoice totals */}
            <div style={{ fontSize: "9.5px", ...(tot.showGstBreakdown ? {} : { gridColumn: "1 / -1" }) }}>
              {tot.showSubtotal && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #f0f0f0" }}>
                  <span>Subtotal (MRP)</span><span>{formatCurrency(invoice.subtotal)}</span>
                </div>
              )}
              {tot.showDiscount && invoice.discountAmount > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: "#16a34a", borderBottom: "1px solid #f0f0f0" }}>
                  <span>Discount</span><span>− {formatCurrency(invoice.discountAmount)}</span>
                </div>
              )}
              {tot.showSavings && invoice.discountAmount > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: "#16a34a", borderBottom: "1px solid #f0f0f0" }}>
                  <span>You Save</span><span>{formatCurrency(invoice.discountAmount)}</span>
                </div>
              )}
              {tot.showTaxable && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #f0f0f0" }}>
                  <span>Taxable Amount</span><span>{formatCurrency(invoice.taxableAmount)}</span>
                </div>
              )}
              {!isInterstate && tot.showCgst && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #f0f0f0" }}>
                  <span>CGST</span><span>{formatCurrency(invoice.cgst)}</span>
                </div>
              )}
              {!isInterstate && tot.showSgst && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #f0f0f0" }}>
                  <span>SGST</span><span>{formatCurrency(invoice.sgst)}</span>
                </div>
              )}
              {isInterstate && tot.showIgst && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #f0f0f0" }}>
                  <span>IGST</span><span>{formatCurrency(invoice.igst)}</span>
                </div>
              )}
              {tot.showRoundOff && Math.abs(roundOff) >= 0.005 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: "#999", borderBottom: "1px solid #f0f0f0" }}>
                  <span>Round Off</span><span>{roundOff > 0 ? "+" : ""}{roundOff.toFixed(2)}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0 4px", borderTop: `2px solid ${primary}`, fontWeight: 700, fontSize: "13px", marginTop: "4px" }}>
                <span>Net Payable</span><span>₹{roundedTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* ── Amount in words ───────────────────────────────────────────────── */}
          {tot.showAmountWords && (
            <div style={{ background: "#f5f5f5", border: "1px solid #e0e0e0", borderRadius: "4px", padding: "5px 10px", marginBottom: "16px", fontSize: "9px" }}>
              <strong>Amount in Words: </strong><em>{formatAmountInWords(roundedTotal)}</em>
            </div>
          )}

          {/* ── Footer ───────────────────────────────────────────────────────── */}
          <div style={{ borderTop: "1px solid #ccc", paddingTop: "10px", display: "grid", gridTemplateColumns: ftr.showSignature ? "1fr 1fr" : "1fr", gap: "16px", fontSize: "9px", color: "#666" }}>
            <div>
              {ftr.terms && (
                <>
                  <p style={{ fontWeight: 600, color: "#333", marginBottom: "4px" }}>Terms & Conditions</p>
                  {ftr.terms.split("\n").map((line, i) => (
                    <p key={i}>• {line}</p>
                  ))}
                </>
              )}
              {ftr.contactInfo && <p style={{ marginTop: "6px" }}>{ftr.contactInfo}</p>}
            </div>

            {ftr.showSignature && (
              <div style={{ textAlign: "right" }}>
                <div style={{ marginTop: "30px", borderTop: "1px solid #999", paddingTop: "4px", display: "inline-block", minWidth: "120px" }}>
                  <p style={{ fontWeight: 600, color: "#333" }}>{ftr.signatureLabel}</p>
                  <p>{displayName}</p>
                </div>
              </div>
            )}
          </div>

          {ftr.thankYouText && (
            <p style={{ textAlign: "center", marginTop: "12px", fontSize: "9.5px", color: "#777", fontStyle: "italic" }}>
              {ftr.thankYouText}
            </p>
          )}

          {ftr.showQrCode && ftr.upiId && (
            <div style={{ textAlign: "center", marginTop: "10px" }}>
              <p style={{ fontSize: "9px", color: "#555" }}>UPI: <strong>{ftr.upiId}</strong></p>
            </div>
          )}

          <p style={{ textAlign: "center", marginTop: "8px", fontSize: "8px", color: "#bbb" }}>
            This is a computer-generated invoice.
          </p>
        </div>
      </div>
    );
  }
);
