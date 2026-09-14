import { format } from "date-fns";
import { normalizeInvoiceSettings } from "@pharmacy/types";
import { formatAmountInWords, baseUnitShort, formatCurrency } from "@pharmacy/utils";
import type { InvoiceSettingsConfig } from "@pharmacy/types";
import type { PrintInvoiceData, PharmacyProfile } from "./InvoicePrintView";

// ─── Thermal-specific constants ───────────────────────────────────────────────
// 80mm paper: usable ~72mm at 96dpi ≈ 272px, ~38 chars per line in monospace
// 58mm paper: usable ~50mm ≈ 189px,  ~26 chars per line

const CHAR_WIDTHS: Record<string, number> = { thermal80: 38, thermal58: 26 };
const PAPER_PX:   Record<string, string>  = { thermal80: "272px", thermal58: "189px" };

function line(char: string, n: number) {
  return char.repeat(n);
}

function row(left: string, right: string, width: number) {
  const pad = Math.max(1, width - left.length - right.length);
  return left + " ".repeat(pad) + right;
}

/**
 * WHICH SETTINGS THIS VIEW HONOURS
 *
 * The intent is that a setting means the same thing on every print format, so a
 * pharmacy does not have to learn which toggles happen to apply to which paper.
 * This receipt therefore follows the A4/A5 invoice for content decisions: which
 * columns to show, which totals to print, patient and header fields, terms,
 * signature, amount in words.
 *
 * Deliberately NOT honoured, because they describe a page this paper does not have:
 *   · branding.watermarkText   — a 58mm roll has no area to place one
 *   · branding.logoPosition / logoSize / showLogo — thermal printers render a
 *     monospace character stream; there is no image layout to position
 *   · header.align             — every line is centred or column-aligned by design
 *   · branding.primaryColor / pharmacyNameStyle — single-colour thermal head
 *   · paper margins and A4/A5 sizing
 */

const PREVIEW_PHARMACY: PharmacyProfile = {
  name:        "Checkup Pharmacy",
  address:     "123 MG Road, Mumbai 400058",
  phone:       "+91 98765 43210",
  gstin:       "27ABCDE1234F1Z5",
  drugLicense: "MH-MUM-1234",
};

type Props = {
  invoice:   PrintInvoiceData;
  config?:   Partial<InvoiceSettingsConfig>;
  pharmacy?: PharmacyProfile;
};

export function ThermalReceiptView({ invoice, config: configProp, pharmacy: pharmacyProp }: Props) {
  const cfg      = normalizeInvoiceSettings(configProp);
  const pharmacy = pharmacyProp ?? PREVIEW_PHARMACY;
  const hdr      = cfg.header;
  const pat      = cfg.patient;
  // A cut-strip line prices per piece, so the per-piece rate must print even when
  // the pharmacy hides the rate column — otherwise "8 tab ... 73.04" cannot be
  // checked against anything. Batch + expiry are forced on per line below.
  const hasLoose = invoice.items.some((it) => it.saleUnit === "LOOSE");
  const col      = hasLoose ? { ...cfg.columns, showRate: true, showMrp: true } : cfg.columns;
  const tot      = cfg.totals;
  const ftr      = cfg.footer;
  const br       = cfg.branding;

  const paperKey  = cfg.paper.size === "thermal58" ? "thermal58" : "thermal80";
  const W         = CHAR_WIDTHS[paperKey]!;
  const paperW    = PAPER_PX[paperKey]!;
  const displayName = br.pharmacyNameOverride || pharmacy.name;
  const extraCharges = invoice.extraCharges ?? 0;
  const adjustment   = invoice.adjustmentAmount ?? 0;
  // The totals block foots from its own rows: taxable + tax + charges + adjustment + roundOff.
  const taxAndCharges = invoice.taxableAmount + invoice.totalGst + extraCharges + adjustment;
  // Stored footing delta (rupee rounding + the equal CGST/SGST split's odd paisa); the plain
  // rupee rounding is the fallback for callers that don't pass one.
  const roundOff     = invoice.roundOff ?? (Math.round(taxAndCharges) - taxAndCharges);
  const roundedTotal = Math.round(taxAndCharges + roundOff);
  const isInterstate = invoice.isInterstate ?? false;

  // Same slab aggregation as InvoicePrintView, so both formats report identical
  // GST figures for the same bill.
  const slabs = invoice.items.reduce<
    Record<number, { taxable: number; cgst: number; sgst: number; igst: number }>
  >((acc, item) => {
    if (!acc[item.gstRate]) acc[item.gstRate] = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    acc[item.gstRate]!.taxable += item.taxableAmount;
    acc[item.gstRate]!.cgst    += item.cgst;
    acc[item.gstRate]!.sgst    += item.sgst;
    acc[item.gstRate]!.igst    += item.igst;
    return acc;
  }, {});

  const center = (s: string) => {
    if (s.length >= W) return s;
    const pad = Math.floor((W - s.length) / 2);
    return " ".repeat(pad) + s;
  };

  const mono: React.CSSProperties = {
    fontFamily: "'Courier New', Courier, monospace",
    fontSize: paperKey === "thermal58" ? "10px" : "11px",
    lineHeight: "1.5",
    whiteSpace: "pre",
    color: "#000",
  };

  return (
    <div
      style={{
        width: paperW,
        background: "#fff",
        padding: "6px 8px",
        ...mono,
      }}
    >
      {/* Header */}
      {hdr.showName && (
        <div style={{ textAlign: "center", fontWeight: 700, fontSize: paperKey === "thermal58" ? "12px" : "13px", marginBottom: "2px" }}>
          {displayName}
        </div>
      )}
      {hdr.showAddress && pharmacy.address && (
        <div style={{ textAlign: "center", fontSize: "9px" }}>{pharmacy.address}</div>
      )}
      {hdr.showPhone && pharmacy.phone && (
        <div style={{ textAlign: "center", fontSize: "9px" }}>Tel: {pharmacy.phone}</div>
      )}
      {hdr.showEmail && pharmacy.email && (
        <div style={{ textAlign: "center", fontSize: "9px" }}>{pharmacy.email}</div>
      )}
      {hdr.showWebsite && pharmacy.website && (
        <div style={{ textAlign: "center", fontSize: "9px" }}>{pharmacy.website}</div>
      )}
      {hdr.showGstin && pharmacy.gstin && (
        <div style={{ textAlign: "center", fontSize: "9px" }}>GSTIN: {pharmacy.gstin}</div>
      )}
      {hdr.showDrugLicense && pharmacy.drugLicense && (
        <div style={{ textAlign: "center", fontSize: "9px" }}>DL: {pharmacy.drugLicense}</div>
      )}
      {hdr.showFssai && pharmacy.fssai && (
        <div style={{ textAlign: "center", fontSize: "9px" }}>FSSAI: {pharmacy.fssai}</div>
      )}
      {hdr.customText && (
        <div style={{ textAlign: "center", fontSize: "9px", marginTop: "2px" }}>{hdr.customText}</div>
      )}

      <div style={mono}>{line("-", W)}</div>
      <div style={{ textAlign: "center", fontWeight: 700 }}>TAX INVOICE</div>
      <div style={mono}>{line("-", W)}</div>

      {/* Invoice meta */}
      <div style={mono}>{row("Bill No:", invoice.invoiceNumber, W)}</div>
      {pat.showInvoiceDate && (
        <div style={mono}>{row("Date:", format(new Date(invoice.createdAt), "dd/MM/yy HH:mm"), W)}</div>
      )}
      {/* A split bill gets one line per leg. Thermal paper is too narrow to fit them
          on one row, and stacking is what a till roll does anyway — the customer still
          needs to see that part of this went on the card and part in cash. */}
      {tot.showPaymentMode && ((invoice.tenders?.length ?? 0) > 1 ? (
        <>
          <div style={mono}>{row("Payment:", `SPLIT/${invoice.paymentStatus}`, W)}</div>
          {invoice.tenders!.map((t, i) => (
            <div key={`${t.mode}-${i}`} style={mono}>{row(`  ${t.mode}`, formatCurrency(t.amount), W)}</div>
          ))}
        </>
      ) : (
        <div style={mono}>{row("Payment:", `${invoice.paymentMode}/${invoice.paymentStatus}`, W)}</div>
      ))}
      {pat.showName           && invoice.customerName    && <div style={mono}>{row("Patient:",  invoice.customerName,    W)}</div>}
      {pat.showMobile         && invoice.customerPhone   && <div style={mono}>{row("Mobile:",   invoice.customerPhone,   W)}</div>}
      {pat.showAddress        && invoice.customerAddress && <div style={mono}>{row("Address:",  invoice.customerAddress, W)}</div>}
      {pat.showUhid           && invoice.uhid            && <div style={mono}>{row("UHID:",     invoice.uhid,            W)}</div>}
      {pat.showAbha           && invoice.abha            && <div style={mono}>{row("ABHA:",     invoice.abha,            W)}</div>}
      {pat.showDoctor         && invoice.doctorName      && <div style={mono}>{row("Doctor:",   invoice.doctorName,      W)}</div>}
      {pat.showDoctor         && invoice.doctorRegNo     && <div style={mono}>{row("Reg No:",   invoice.doctorRegNo,     W)}</div>}
      {pat.showPrescriptionNo && invoice.prescriptionNo  && <div style={mono}>{row("Rx No:",    invoice.prescriptionNo,  W)}</div>}
      {pat.showCashier        && invoice.cashierName     && <div style={mono}>{row("Cashier:",  invoice.cashierName,     W)}</div>}

      <div style={mono}>{line("-", W)}</div>

      {/* Items */}
      {invoice.items.map((item, i) => {
        // A loose (cut-strip) line: quantity is pieces, rate/MRP are per-piece, and
        // batch + expiry MUST print regardless of the column toggles (Drug Rules —
        // the customer needs them for cut tablets that no longer carry the foil).
        const isLoose = item.saleUnit === "LOOSE";
        const unit    = baseUnitShort(item.baseUnit);
        return (
        <div key={i}>
          {/* Medicine name line */}
          <div style={{ fontWeight: 600, fontSize: "10px" }}>
            {i + 1}. {item.medicineName}
            {isLoose && <span style={{ fontWeight: 400, fontSize: "9px" }}> (loose)</span>}
          </div>
          {/* Batch/expiry/HSN line */}
          {(isLoose || col.showBatch || col.showExpiry || (col.showHsn && item.hsnCode)) && (
            <div style={{ fontSize: "9px", color: "#444" }}>
              {(isLoose || col.showBatch)  && `Batch:${item.batchNumber} `}
              {(isLoose || col.showExpiry) && `Exp:${format(new Date(item.expiryDate), "MM/yy")} `}
              {col.showHsn && item.hsnCode && `HSN:${item.hsnCode}`}
            </div>
          )}
          {/* Patient remarks — printed on the slip the patient takes home, so a syrup
              course reads "5 ml 3 times a day for 7 days" even though the bill line is
              "2 bottles". The internal round-up note (clinicalNote) is NEVER printed. */}
          {(item.patientRemarks ?? item.dosageInstructions) && (
            <div style={{ fontSize: "9px", color: "#000", fontWeight: 600, whiteSpace: "normal" }}>
              {`  Dosage: ${item.patientRemarks ?? item.dosageInstructions}`}
            </div>
          )}
          {/* MRP line — only worth its own row when it differs from the sale rate,
              i.e. when a discount was applied. Printing "MRP 15.00 / Rate 15.00" on
              every line of a 58mm roll is noise and paper. */}
          {col.showMrp && (isLoose || item.mrp > item.rate) && (
            <div style={{ fontSize: "9px", color: "#444" }}>
              {isLoose ? `  MRP:${item.mrp.toFixed(2)}/pack` : `  MRP:${item.mrp.toFixed(2)}`}
            </div>
          )}
          {/* Qty × Rate = Amount line. Rate and the discount badge are each
              individually suppressible, matching the A4 column toggles; the
              quantity and the line amount always print — a receipt without them
              is not a receipt. A loose line reads "8 tab x 2.23". */}
          <div style={mono}>
            {row(
              `  ${item.quantity}${isLoose && item.baseUnit ? ` ${unit}` : isLoose ? " loose" : ""}${col.showRate ? ` x ${item.rate.toFixed(2)}` : ""}`
                + (col.showDiscount && item.discount > 0 ? ` (-${item.discount}%)` : ""),
              `${item.amount.toFixed(2)}`,
              W,
            )}
          </div>
          {/* Scheme quantity — printed only when the line actually has one, so
              ordinary rows do not each gain a "Free: 0" line of wasted paper. */}
          {col.showFreeQty && (item.freeQty ?? 0) > 0 && (
            <div style={{ fontSize: "9px", color: "#444" }}>
              {`  + ${item.freeQty} FREE`}
            </div>
          )}
          {/* Taxable value per line — GST-mandated, so this toggle is locked on.
              Wraps rather than being column-aligned; at 26 characters it will not
              share a row with the GST figures. */}
          {col.showTaxable && (
            <div style={{ fontSize: "9px", color: "#555", whiteSpace: "normal" }}>
              {`  Taxable:${item.taxableAmount.toFixed(2)}`}
            </div>
          )}
          {/* GST line */}
          {col.showGstRate && (
            <div style={{ fontSize: "9px", color: "#555", whiteSpace: "normal" }}>
              {"  "}
              {isInterstate
                ? `IGST ${item.gstRate}%: ${(item.igst || item.cgst + item.sgst).toFixed(2)}`
                : `CGST ${item.gstRate / 2}%: ${item.cgst.toFixed(2)}  SGST ${item.gstRate / 2}%: ${item.sgst.toFixed(2)}`
              }
            </div>
          )}
        </div>
        );
      })}

      <div style={mono}>{line("=", W)}</div>

      {/* Slab-wise GST summary — required on a GST tax invoice, hence locked on.
          Rendered as aligned monospace rows rather than the A4 table, which is the
          same information in the form this paper can carry. */}
      {tot.showGstBreakdown && Object.keys(slabs).length > 0 && (
        <>
          <div style={{ ...mono, fontWeight: 600 }}>GST Summary</div>
          {Object.entries(slabs)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([rate, v]) => (
              <div key={rate} style={{ ...mono, fontSize: "9px" }}>
                {row(
                  `${rate}% on ${v.taxable.toFixed(2)}`,
                  isInterstate
                    ? v.igst.toFixed(2)
                    : (v.cgst + v.sgst).toFixed(2),
                  W,
                )}
              </div>
            ))}
          <div style={mono}>{line("-", W)}</div>
        </>
      )}

      {/* Totals */}
      {tot.showSubtotal  && <div style={mono}>{row("Subtotal:",      invoice.subtotal.toFixed(2),          W)}</div>}
      {tot.showDiscount  && invoice.discountAmount > 0 &&
                           <div style={mono}>{row("Discount:",       `-${invoice.discountAmount.toFixed(2)}`, W)}</div>}
      {tot.showSavings   && invoice.discountAmount > 0 &&
                           <div style={mono}>{row("You Save:",      invoice.discountAmount.toFixed(2),      W)}</div>}
      {tot.showTaxable   && <div style={mono}>{row("Taxable:",       invoice.taxableAmount.toFixed(2),      W)}</div>}
      {!isInterstate && tot.showCgst && <div style={mono}>{row("CGST:", invoice.cgst.toFixed(2), W)}</div>}
      {!isInterstate && tot.showSgst && <div style={mono}>{row("SGST:", invoice.sgst.toFixed(2), W)}</div>}
      {isInterstate  && tot.showIgst && <div style={mono}>{row("IGST:", invoice.igst.toFixed(2), W)}</div>}
      {extraCharges > 0 && <div style={mono}>{row("Extra Charges:", extraCharges.toFixed(2), W)}</div>}
      {Math.abs(adjustment) >= 0.005 &&
                           <div style={mono}>{row("Adjustment:", `${adjustment > 0 ? "+" : "-"}${Math.abs(adjustment).toFixed(2)}`, W)}</div>}
      {tot.showRoundOff && Math.abs(roundOff) >= 0.005 &&
                           <div style={mono}>{row("Round Off:",    `${roundOff > 0 ? "+" : "-"}${Math.abs(roundOff).toFixed(2)}`, W)}</div>}

      <div style={{ ...mono, fontWeight: 700 }}>{line("=", W)}</div>
      <div style={{ ...mono, fontWeight: 700, fontSize: "13px" }}>
        {row("NET PAYABLE:", `${roundedTotal.toFixed(2)}`, W)}
      </div>
      <div style={{ ...mono, fontWeight: 700 }}>{line("=", W)}</div>

      {/* Amount in words — wraps rather than pre-formatted, since it is prose and
          routinely exceeds the 26/38-character line width. */}
      {tot.showAmountWords && (
        <div style={{ marginTop: "4px", fontSize: "8.5px", color: "#333", whiteSpace: "normal" }}>
          <strong>In Words: </strong>{formatAmountInWords(roundedTotal)}
        </div>
      )}

      {/* Footer */}
      {ftr.showQrCode && ftr.upiId && (
        <div style={{ textAlign: "center", marginTop: "6px", fontSize: "9px" }}>
          UPI: {ftr.upiId}
        </div>
      )}

      {ftr.thankYouText && (
        <div style={{ textAlign: "center", marginTop: "8px", fontSize: "9px" }}>
          {center(ftr.thankYouText)}
        </div>
      )}

      {ftr.terms && (
        <div style={{ marginTop: "4px", fontSize: "8.5px", color: "#555" }}>
          <div style={mono}>{line("-", W)}</div>
          {ftr.terms.split("\n").map((line, i) => (
            <div key={i}>* {line}</div>
          ))}
        </div>
      )}

      {ftr.contactInfo && (
        <div style={{ textAlign: "center", marginTop: "4px", fontSize: "8.5px", color: "#555", whiteSpace: "normal" }}>
          {ftr.contactInfo}
        </div>
      )}

      {/* Signature block — blank space to sign, then the label. Cheap in paper
          (three short lines) so the A4 setting carries over rather than being
          silently dropped on thermal. */}
      {ftr.showSignature && (
        <div style={{ marginTop: "10px", fontSize: "9px", textAlign: "right" }}>
          <div style={{ marginTop: "16px" }}>{line("_", Math.min(W, 18))}</div>
          <div>{ftr.signatureLabel}</div>
        </div>
      )}

      <div style={{ textAlign: "center", marginTop: "6px", fontSize: "8px", color: "#888" }}>
        Computer generated receipt
      </div>
      {/* Thermal cut mark */}
      <div style={{ textAlign: "center", marginTop: "12px", fontSize: "10px", color: "#ccc" }}>
        - - - - - - - - - - - - - - - - -
      </div>
    </div>
  );
}
