import { format } from "date-fns";
import { defaultInvoiceSettings } from "@pharmacy/types";
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

function merge(config?: Partial<InvoiceSettingsConfig>): InvoiceSettingsConfig {
  if (!config) return defaultInvoiceSettings;
  return {
    ...defaultInvoiceSettings,
    ...config,
    branding: { ...defaultInvoiceSettings.branding, ...config.branding },
    header:   { ...defaultInvoiceSettings.header,   ...config.header   },
    patient:  { ...defaultInvoiceSettings.patient,  ...config.patient  },
    columns:  { ...defaultInvoiceSettings.columns,  ...config.columns  },
    totals:   { ...defaultInvoiceSettings.totals,   ...config.totals   },
    footer:   { ...defaultInvoiceSettings.footer,   ...config.footer   },
    numbering:{ ...defaultInvoiceSettings.numbering,...config.numbering },
    paper:    { ...defaultInvoiceSettings.paper,    ...config.paper    },
    policy:   { ...defaultInvoiceSettings.policy,   ...config.policy   },
  };
}

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
  const cfg      = merge(configProp);
  const pharmacy = pharmacyProp ?? PREVIEW_PHARMACY;
  const hdr      = cfg.header;
  const pat      = cfg.patient;
  const col      = cfg.columns;
  const tot      = cfg.totals;
  const ftr      = cfg.footer;
  const br       = cfg.branding;

  const paperKey  = cfg.paper.size === "thermal58" ? "thermal58" : "thermal80";
  const W         = CHAR_WIDTHS[paperKey]!;
  const paperW    = PAPER_PX[paperKey]!;
  const displayName = br.pharmacyNameOverride || pharmacy.name;
  const roundedTotal = Math.round(invoice.totalAmount);
  const roundOff     = roundedTotal - invoice.totalAmount;
  const isInterstate = invoice.isInterstate ?? false;

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
      {hdr.showGstin && pharmacy.gstin && (
        <div style={{ textAlign: "center", fontSize: "9px" }}>GSTIN: {pharmacy.gstin}</div>
      )}
      {hdr.showDrugLicense && pharmacy.drugLicense && (
        <div style={{ textAlign: "center", fontSize: "9px" }}>DL: {pharmacy.drugLicense}</div>
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
      {tot.showPaymentMode && (
        <div style={mono}>{row("Payment:", `${invoice.paymentMode}/${invoice.paymentStatus}`, W)}</div>
      )}
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
      {invoice.items.map((item, i) => (
        <div key={i}>
          {/* Medicine name line */}
          <div style={{ fontWeight: 600, fontSize: "10px" }}>
            {i + 1}. {item.medicineName}
          </div>
          {/* Batch/expiry line */}
          {(col.showBatch || col.showExpiry) && (
            <div style={{ fontSize: "9px", color: "#444" }}>
              {col.showBatch  && `Batch:${item.batchNumber} `}
              {col.showExpiry && `Exp:${format(new Date(item.expiryDate), "MM/yy")} `}
              {col.showHsn && item.hsnCode && `HSN:${item.hsnCode}`}
            </div>
          )}
          {/* Qty × Rate = Amount line */}
          <div style={mono}>
            {row(
              `  ${item.quantity} x ${item.rate.toFixed(2)}${item.discount > 0 ? ` (-${item.discount}%)` : ""}`,
              `${item.amount.toFixed(2)}`,
              W,
            )}
          </div>
          {/* GST line */}
          {col.showGstRate && (
            <div style={{ fontSize: "9px", color: "#555" }}>
              {"  "}
              {isInterstate
                ? `IGST ${item.gstRate}%: ${(item.igst || item.cgst + item.sgst).toFixed(2)}`
                : `CGST ${item.gstRate / 2}%: ${item.cgst.toFixed(2)}  SGST ${item.gstRate / 2}%: ${item.sgst.toFixed(2)}`
              }
            </div>
          )}
        </div>
      ))}

      <div style={mono}>{line("=", W)}</div>

      {/* Totals */}
      {tot.showSubtotal  && <div style={mono}>{row("Subtotal:",      invoice.subtotal.toFixed(2),          W)}</div>}
      {tot.showDiscount  && invoice.discountAmount > 0 &&
                           <div style={mono}>{row("Discount:",       `-${invoice.discountAmount.toFixed(2)}`, W)}</div>}
      {tot.showTaxable   && <div style={mono}>{row("Taxable:",       invoice.taxableAmount.toFixed(2),      W)}</div>}
      {!isInterstate && tot.showCgst && <div style={mono}>{row("CGST:", invoice.cgst.toFixed(2), W)}</div>}
      {!isInterstate && tot.showSgst && <div style={mono}>{row("SGST:", invoice.sgst.toFixed(2), W)}</div>}
      {isInterstate  && tot.showIgst && <div style={mono}>{row("IGST:", invoice.igst.toFixed(2), W)}</div>}
      {tot.showRoundOff && Math.abs(roundOff) >= 0.005 &&
                           <div style={mono}>{row("Round Off:",    `${roundOff > 0 ? "+" : ""}${roundOff.toFixed(2)}`, W)}</div>}

      <div style={{ ...mono, fontWeight: 700 }}>{line("=", W)}</div>
      <div style={{ ...mono, fontWeight: 700, fontSize: "13px" }}>
        {row("NET PAYABLE:", `${roundedTotal.toFixed(2)}`, W)}
      </div>
      <div style={{ ...mono, fontWeight: 700 }}>{line("=", W)}</div>

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
