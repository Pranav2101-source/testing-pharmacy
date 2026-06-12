import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Save, CheckCircle2, Loader2, Lock, RefreshCw, Plus, Trash2,
  AlertTriangle, Eye, ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import { defaultInvoiceSettings } from "@pharmacy/types";
import type { InvoiceSettingsConfig, PaperSize, InvoiceTheme, CustomField } from "@pharmacy/types";
import { InvoicePrintView } from "@/components/billing/InvoicePrintView";
import { ThermalReceiptView } from "@/components/billing/ThermalReceiptView";
import type { PrintInvoiceData } from "@/components/billing/InvoicePrintView";
import { invalidateInvoicePrintConfigCache } from "@/lib/useInvoicePrintConfig";

// ─── Mock data for the live preview ──────────────────────────────────────────

const MOCK_INVOICE: PrintInvoiceData = {
  invoiceNumber:    "INV/25-26/000042",
  createdAt:        new Date().toISOString(),
  customerName:     "Raju Sharma",
  customerPhone:    "+91 99887 76655",
  customerAddress:  "42, Shivaji Nagar, Pune 411005",
  uhid:             "UHID-2025-00789",
  abha:             "91-1234-5678-9012",
  prescriptionNo:   "RX-2025-0042",
  doctorName:       "Dr. Priya Mehta",
  cashierName:      "Jitesh Kumar",
  paymentMode:      "CASH",
  paymentStatus:    "PAID",
  isInterstate:     false,
  items: [
    {
      medicineName: "Paracetamol 500mg",
      hsnCode: "30049099", batchNumber: "PCM/24/001",
      expiryDate: "2026-09-30", mrp: 15, quantity: 2, discount: 0,
      gstRate: 12, rate: 15, taxableAmount: 26.79, cgst: 1.61, sgst: 1.61, igst: 0, amount: 30,
    },
    {
      medicineName: "Azithromycin 500mg",
      hsnCode: "30041090", batchNumber: "AZI/25/001",
      expiryDate: "2027-02-28", mrp: 145, quantity: 1, discount: 5,
      gstRate: 12, rate: 137.75, taxableAmount: 122.99, cgst: 7.38, sgst: 7.38, igst: 0, amount: 137.75,
    },
    {
      medicineName: "Vitamin D3 60000 IU",
      hsnCode: "30049099", batchNumber: "VTD/25/001",
      expiryDate: "2027-03-31", mrp: 75, quantity: 1, discount: 0,
      gstRate: 5, rate: 75, taxableAmount: 71.43, cgst: 1.79, sgst: 1.79, igst: 0, amount: 75,
    },
  ],
  subtotal: 235, discountAmount: 7.25,
  taxableAmount: 221.21, cgst: 10.78, sgst: 10.78, igst: 0,
  totalGst: 21.56, totalAmount: 242.75,
};

// ─── Deep merge helper ────────────────────────────────────────────────────────

function mergeDefaults(partial: Partial<InvoiceSettingsConfig>): InvoiceSettingsConfig {
  return {
    ...defaultInvoiceSettings,
    ...partial,
    branding:     { ...defaultInvoiceSettings.branding,     ...partial.branding     },
    header:       { ...defaultInvoiceSettings.header,       ...partial.header,       showGstin: true },
    patient:      { ...defaultInvoiceSettings.patient,      ...partial.patient      },
    columns:      { ...defaultInvoiceSettings.columns,      ...partial.columns,      showHsn: true, showGstRate: true, showTaxable: true },
    totals:       { ...defaultInvoiceSettings.totals,       ...partial.totals,       showTaxable: true, showCgst: true, showSgst: true, showIgst: true, showGstBreakdown: true },
    footer:       { ...defaultInvoiceSettings.footer,       ...partial.footer       },
    numbering:    { ...defaultInvoiceSettings.numbering,    ...partial.numbering    },
    paper:        { ...defaultInvoiceSettings.paper,        ...partial.paper        },
    policy:       { ...defaultInvoiceSettings.policy,       ...partial.policy       },
    customFields: partial.customFields ?? defaultInvoiceSettings.customFields,
  };
}

// ─── Section names ────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "paper",     label: "Paper & Theme"    },
  { id: "branding",  label: "Branding"         },
  { id: "header",    label: "Header"           },
  { id: "patient",   label: "Patient Info"     },
  { id: "columns",   label: "Table Columns"    },
  { id: "totals",    label: "Financial Summary"},
  { id: "footer",    label: "Footer"           },
  { id: "numbering", label: "Numbering"        },
  { id: "custom",    label: "Custom Fields"    },
] as const;

type SectionId = typeof SECTIONS[number]["id"];

// ─── Reusable form primitives ─────────────────────────────────────────────────

function ToggleRow({
  label, sub, value, onChange, locked, lockReason,
}: {
  label: string; sub?: string; value: boolean;
  onChange: (v: boolean) => void;
  locked?: boolean; lockReason?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0 group">
      <div className="flex-1 min-w-0 pr-4">
        <span className="text-[13px] font-medium text-slate-700">{label}</span>
        {locked && (
          <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
            <Lock className="w-2.5 h-2.5" />GST Required
          </span>
        )}
        {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
        {locked && lockReason && (
          <p className="text-[10px] text-amber-600 mt-0.5">{lockReason}</p>
        )}
      </div>
      {locked ? (
        <div className="w-9 h-5 rounded-full bg-blue-600 relative opacity-80 cursor-not-allowed flex-shrink-0">
          <span className="absolute right-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow-sm" />
        </div>
      ) : (
        <button
          onClick={() => onChange(!value)}
          role="switch" aria-checked={value}
          className={cn(
            "relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
            value ? "bg-blue-600" : "bg-slate-200 hover:bg-slate-300"
          )}
        >
          <span
            className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 will-change-transform"
            style={{ transform: value ? "translateX(16px)" : "translateX(0)" }}
          />
        </button>
      )}
    </div>
  );
}

function InputRow({
  label, value, onChange, placeholder, textarea, type = "text",
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; textarea?: boolean; type?: string;
}) {
  const cls = "w-full border border-slate-200 rounded-lg px-3 py-1.5 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 bg-white";
  return (
    <div className="py-2.5 border-b border-slate-100 last:border-0">
      <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">{label}</label>
      {textarea
        ? <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3} className={cn(cls, "resize-none")} />
        : <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      }
    </div>
  );
}

function SegmentRow<T extends string>({
  label, value, onChange, options,
}: {
  label: string; value: T; onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="py-2.5 border-b border-slate-100 last:border-0">
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">{label}</p>
      <div className="flex gap-1 flex-wrap">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "px-3 py-1 rounded-lg text-[12px] font-medium border transition-all",
              value === opt.value
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-[13px] font-medium text-slate-700">{label}</span>
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md border border-slate-200 shadow-sm" style={{ background: value }} />
        <input
          type="color" value={value} onChange={e => onChange(e.target.value)}
          className="w-8 h-8 rounded-lg border-0 cursor-pointer bg-transparent"
        />
        <input
          type="text" value={value} onChange={e => onChange(e.target.value)}
          placeholder="#1a3080"
          className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
      </div>
    </div>
  );
}

function NumberRow({ label, value, onChange, min, max }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-[13px] font-medium text-slate-700">{label}</span>
      <input
        type="number" value={value} min={min} max={max}
        onChange={e => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n)) onChange(n);
        }}
        className="w-20 border border-slate-200 rounded-lg px-3 py-1 text-[13px] text-right focus:outline-none focus:ring-2 focus:ring-blue-100"
      />
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
        <p className="text-[13px] font-bold text-slate-700">{title}</p>
      </div>
      <div className="px-4">{children}</div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function InvoiceSettingsPage() {
  const [config,   setConfig]   = useState<InvoiceSettingsConfig>(defaultInvoiceSettings);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("paper");

  const isThermal = config.paper.size === "thermal80" || config.paper.size === "thermal58";

  // ── Load settings ──────────────────────────────────────────────
  useEffect(() => {
    api.get("/billing/settings")
      .then(({ data }) => {
        if (data.data) setConfig(mergeDefaults(data.data));
      })
      .catch(() => {/* no settings yet — use defaults */})
      .finally(() => setLoading(false));
  }, []);

  // ── Section updaters ───────────────────────────────────────────
  const setSection = useCallback(<K extends keyof InvoiceSettingsConfig>(
    key: K,
    patch: Partial<InvoiceSettingsConfig[K]> | InvoiceSettingsConfig[K],
  ) => {
    setConfig(prev => ({
      ...prev,
      [key]: typeof patch === "object" && patch !== null && !Array.isArray(patch)
        ? { ...(prev[key] as object), ...(patch as object) }
        : patch,
    }));
  }, []);

  // ── Save ───────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      // Strip currentSequence — it is managed server-side and must not be
      // overwritten from the UI payload (would corrupt the invoice counter).
      const { currentSequence: _seq, ...numberingToSave } = config.numbering;
      const payload = { ...config, numbering: numberingToSave };
      await api.put("/billing/settings", payload);
      // Bust the module-level cache so BillingNewPage picks up the new config
      // immediately on the next invoice print without a full page reload.
      invalidateInvoicePrintConfigCache();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Failed to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [config]);

  // ── Custom fields ──────────────────────────────────────────────
  function addCustomField() {
    const field: CustomField = {
      id: crypto.randomUUID(), label: "Custom Field", show: true, position: "header",
    };
    setConfig(prev => ({ ...prev, customFields: [...prev.customFields, field] }));
  }

  function updateCustomField(id: string, patch: Partial<CustomField>) {
    setConfig(prev => ({
      ...prev,
      customFields: prev.customFields.map(f => f.id === id ? { ...f, ...patch } : f),
    }));
  }

  function removeCustomField(id: string) {
    setConfig(prev => ({ ...prev, customFields: prev.customFields.filter(f => f.id !== id) }));
  }

  // ── Numbering preview ──────────────────────────────────────────
  const { prefix, financialYear, separator, counterLength } = config.numbering;
  const sampleSeq = "1".padStart(counterLength, "0");
  const numberPreview = financialYear
    ? `${prefix}${separator}${financialYear}${separator}${sampleSeq}`
    : `${prefix}${separator}${sampleSeq}`;

  // ─── Section content renderers ──────────────────────────────────

  function renderSection() {
    switch (activeSection) {

      // ── Paper & Theme ────────────────────────────────────────────
      case "paper": return (
        <div className="space-y-4">
          <SectionCard title="Invoice Theme">
            <div className="py-3 grid grid-cols-3 gap-2">
              {(["classic", "modern", "minimal"] as InvoiceTheme[]).map(t => (
                <button
                  key={t}
                  onClick={() => setSection("theme", t)}
                  className={cn(
                    "rounded-xl border-2 p-3 text-[12px] font-semibold capitalize transition-all",
                    config.theme === t
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 hover:border-slate-300 text-slate-600"
                  )}
                >
                  <div className="h-8 rounded-md mb-2 flex items-center justify-center text-[18px]">
                    {t === "classic" ? "📄" : t === "modern" ? "✨" : "📋"}
                  </div>
                  {t}
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Paper Size">
            <div className="py-3 grid grid-cols-2 gap-2">
              {([
                { value: "A4",        label: "A4",          sub: "210×297mm" },
                { value: "A5",        label: "A5",          sub: "148×210mm" },
                { value: "thermal80", label: "Thermal 80mm",sub: "Receipt printer" },
                { value: "thermal58", label: "Thermal 58mm",sub: "Small receipt" },
              ] as { value: PaperSize; label: string; sub: string }[]).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setSection("paper", { size: opt.value })}
                  className={cn(
                    "rounded-xl border-2 p-3 text-left transition-all",
                    config.paper.size === opt.value
                      ? "border-blue-600 bg-blue-50"
                      : "border-slate-200 hover:border-slate-300"
                  )}
                >
                  <p className={cn("text-[13px] font-semibold", config.paper.size === opt.value ? "text-blue-700" : "text-slate-700")}>
                    {opt.label}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{opt.sub}</p>
                </button>
              ))}
            </div>
          </SectionCard>
        </div>
      );

      // ── Branding ─────────────────────────────────────────────────
      case "branding": return (
        <div className="space-y-4">
          <SectionCard title="Logo">
            <ToggleRow label="Show Logo" value={config.branding.showLogo} onChange={v => setSection("branding", { showLogo: v })} />
            {config.branding.showLogo && (
              <>
                <InputRow label="Logo URL" value={config.branding.logoUrl || ""} onChange={v => setSection("branding", { logoUrl: v || null })} placeholder="https://..." />
                <SegmentRow label="Position" value={config.branding.logoPosition} onChange={v => setSection("branding", { logoPosition: v })}
                  options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]} />
                <SegmentRow label="Size" value={config.branding.logoSize} onChange={v => setSection("branding", { logoSize: v })}
                  options={[{ value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }]} />
              </>
            )}
          </SectionCard>

          <SectionCard title="Colours & Typography">
            <ColorRow label="Primary Colour" value={config.branding.primaryColor} onChange={v => setSection("branding", { primaryColor: v })} />
            <SegmentRow label="Pharmacy Name Style" value={config.branding.pharmacyNameStyle} onChange={v => setSection("branding", { pharmacyNameStyle: v })}
              options={[{ value: "normal", label: "Normal" }, { value: "bold", label: "Bold" }, { value: "italic", label: "Italic" }]} />
          </SectionCard>

          <SectionCard title="Name & Watermark">
            <InputRow label="Pharmacy Name Override" value={config.branding.pharmacyNameOverride} onChange={v => setSection("branding", { pharmacyNameOverride: v })} placeholder="Leave empty to use your registered name" />
            <InputRow label="Watermark Text" value={config.branding.watermarkText} onChange={v => setSection("branding", { watermarkText: v })} placeholder="e.g. DUPLICATE — empty = none" />
          </SectionCard>
        </div>
      );

      // ── Header ───────────────────────────────────────────────────
      case "header": return (
        <div className="space-y-4">
          <SectionCard title="Alignment">
            <SegmentRow label="Header Alignment" value={config.header.align} onChange={v => setSection("header", { align: v })}
              options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]} />
          </SectionCard>
          <SectionCard title="Pharmacy Details">
            <ToggleRow label="Pharmacy Name"  value={config.header.showName}        onChange={v => setSection("header", { showName: v })} />
            <ToggleRow label="Address"        value={config.header.showAddress}     onChange={v => setSection("header", { showAddress: v })} />
            <ToggleRow label="Phone Number"   value={config.header.showPhone}       onChange={v => setSection("header", { showPhone: v })} />
            <ToggleRow label="Email"          value={config.header.showEmail}       onChange={v => setSection("header", { showEmail: v })} />
            <ToggleRow label="Website"        value={config.header.showWebsite}     onChange={v => setSection("header", { showWebsite: v })} />
            <ToggleRow label="GSTIN"          value={config.header.showGstin}       onChange={v => setSection("header", { showGstin: v })} locked lockReason="Required on all registered GST invoices" />
            <ToggleRow label="Drug License"   value={config.header.showDrugLicense} onChange={v => setSection("header", { showDrugLicense: v })} />
            <ToggleRow label="FSSAI Number"   value={config.header.showFssai}       onChange={v => setSection("header", { showFssai: v })} />
          </SectionCard>
          <SectionCard title="Custom Header Text">
            <InputRow label="Custom text (tagline, etc.)" value={config.header.customText} onChange={v => setSection("header", { customText: v })} placeholder="Your pharmacy tagline or additional info" textarea />
          </SectionCard>
        </div>
      );

      // ── Patient ──────────────────────────────────────────────────
      case "patient": return (
        <SectionCard title="Patient & Transaction Fields">
          <ToggleRow label="Patient Name"       value={config.patient.showName}           onChange={v => setSection("patient", { showName: v })} />
          <ToggleRow label="Mobile Number"      value={config.patient.showMobile}         onChange={v => setSection("patient", { showMobile: v })} />
          <ToggleRow label="Address"            value={config.patient.showAddress}        onChange={v => setSection("patient", { showAddress: v })} />
          <ToggleRow label="UHID"               value={config.patient.showUhid}           onChange={v => setSection("patient", { showUhid: v })} sub="Universal Health ID" />
          <ToggleRow label="ABHA Number"        value={config.patient.showAbha}           onChange={v => setSection("patient", { showAbha: v })} sub="Ayushman Bharat Health Account" />
          <ToggleRow label="Doctor Name"        value={config.patient.showDoctor}         onChange={v => setSection("patient", { showDoctor: v })} />
          <ToggleRow label="Prescription No."   value={config.patient.showPrescriptionNo} onChange={v => setSection("patient", { showPrescriptionNo: v })} />
          <ToggleRow label="Invoice Date & Time"value={config.patient.showInvoiceDate}    onChange={v => setSection("patient", { showInvoiceDate: v })} />
          <ToggleRow label="Cashier Name"       value={config.patient.showCashier}        onChange={v => setSection("patient", { showCashier: v })} />
        </SectionCard>
      );

      // ── Columns ──────────────────────────────────────────────────
      case "columns": return (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" strokeWidth={2} />
            <p className="text-[12px] text-amber-700">Fields marked <strong>GST Required</strong> cannot be disabled on registered GST invoices. Hiding them generates a non-compliant invoice.</p>
          </div>
          <SectionCard title="Medicine Table Columns">
            <ToggleRow label="HSN Code"      value={config.columns.showHsn}      onChange={v => setSection("columns", { showHsn: v })}      locked lockReason="Required for GST invoices per CGST rules" />
            <ToggleRow label="Batch Number"  value={config.columns.showBatch}    onChange={v => setSection("columns", { showBatch: v })} />
            <ToggleRow label="Expiry Date"   value={config.columns.showExpiry}   onChange={v => setSection("columns", { showExpiry: v })} />
            <ToggleRow label="Free Quantity" value={config.columns.showFreeQty}  onChange={v => setSection("columns", { showFreeQty: v })} sub="Bonus/free strips given" />
            <ToggleRow label="MRP"           value={config.columns.showMrp}      onChange={v => setSection("columns", { showMrp: v })} />
            <ToggleRow label="Selling Rate"  value={config.columns.showRate}     onChange={v => setSection("columns", { showRate: v })} />
            <ToggleRow label="Discount %"    value={config.columns.showDiscount} onChange={v => setSection("columns", { showDiscount: v })} />
            <ToggleRow label="GST Rate"      value={config.columns.showGstRate}  onChange={v => setSection("columns", { showGstRate: v })} locked lockReason="GST% must be declared per line item" />
            <ToggleRow label="Taxable Value" value={config.columns.showTaxable}  onChange={v => setSection("columns", { showTaxable: v })} locked lockReason="Taxable value is mandatory under CGST Act" />
          </SectionCard>
        </div>
      );

      // ── Totals ───────────────────────────────────────────────────
      case "totals": return (
        <SectionCard title="Financial Summary Rows">
          <ToggleRow label="Subtotal (MRP)"     value={config.totals.showSubtotal}     onChange={v => setSection("totals", { showSubtotal: v })} />
          <ToggleRow label="Discount"           value={config.totals.showDiscount}     onChange={v => setSection("totals", { showDiscount: v })} />
          <ToggleRow label="You Saved"          value={config.totals.showSavings}      onChange={v => setSection("totals", { showSavings: v })} sub="Friendly savings amount" />
          <ToggleRow label="Taxable Amount"     value={config.totals.showTaxable}      onChange={v => setSection("totals", { showTaxable: v })} locked />
          <ToggleRow label="CGST"               value={config.totals.showCgst}         onChange={v => setSection("totals", { showCgst: v })}    locked />
          <ToggleRow label="SGST"               value={config.totals.showSgst}         onChange={v => setSection("totals", { showSgst: v })}    locked />
          <ToggleRow label="IGST"               value={config.totals.showIgst}         onChange={v => setSection("totals", { showIgst: v })}    locked lockReason="Required for interstate sales" />
          <ToggleRow label="GST Breakdown Table"value={config.totals.showGstBreakdown} onChange={v => setSection("totals", { showGstBreakdown: v })} locked />
          <ToggleRow label="Round Off"          value={config.totals.showRoundOff}     onChange={v => setSection("totals", { showRoundOff: v })} />
          <ToggleRow label="Payment Mode"       value={config.totals.showPaymentMode}  onChange={v => setSection("totals", { showPaymentMode: v })} />
          <ToggleRow label="Amount in Words"    value={config.totals.showAmountWords}  onChange={v => setSection("totals", { showAmountWords: v })} />
        </SectionCard>
      );

      // ── Footer ───────────────────────────────────────────────────
      case "footer": return (
        <div className="space-y-4">
          <SectionCard title="Messages">
            <InputRow label="Thank You Message" value={config.footer.thankYouText} onChange={v => setSection("footer", { thankYouText: v })} placeholder="Thank you for your visit. Get well soon!" />
            <InputRow label="Terms & Conditions" value={config.footer.terms} onChange={v => setSection("footer", { terms: v })} placeholder="One line per term (press Enter for new line)" textarea />
            <InputRow label="Contact Info" value={config.footer.contactInfo} onChange={v => setSection("footer", { contactInfo: v })} placeholder="WhatsApp number, website, etc." />
          </SectionCard>
          <SectionCard title="Signature">
            <ToggleRow label="Show Signature Area" value={config.footer.showSignature} onChange={v => setSection("footer", { showSignature: v })} />
            {config.footer.showSignature && (
              <InputRow label="Signature Label" value={config.footer.signatureLabel} onChange={v => setSection("footer", { signatureLabel: v })} placeholder="Authorized Pharmacist" />
            )}
          </SectionCard>
          <SectionCard title="UPI / QR Code">
            <ToggleRow label="Show UPI QR Code" value={config.footer.showQrCode} onChange={v => setSection("footer", { showQrCode: v })} />
            {config.footer.showQrCode && (
              <InputRow label="UPI ID" value={config.footer.upiId} onChange={v => setSection("footer", { upiId: v })} placeholder="pharmacy@upi" />
            )}
          </SectionCard>
        </div>
      );

      // ── Numbering ────────────────────────────────────────────────
      case "numbering": return (
        <div className="space-y-4">
          {/* Live preview of the number format */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Preview</p>
            <p className="text-[18px] font-bold text-blue-700 font-mono">{numberPreview}</p>
          </div>

          <SectionCard title="Format Settings">
            <InputRow label="Prefix" value={config.numbering.prefix} onChange={v => setSection("numbering", { prefix: v })} placeholder="INV / BILL / RX" />
            <InputRow label="Financial Year (empty = skip)" value={config.numbering.financialYear} onChange={v => setSection("numbering", { financialYear: v })} placeholder="2025-26" />
            <SegmentRow label="Separator" value={config.numbering.separator as "/" | "-"} onChange={v => setSection("numbering", { separator: v })}
              options={[{ value: "/", label: "/ Slash" }, { value: "-", label: "- Hyphen" }]} />
            <NumberRow label="Counter Length (digits)" value={config.numbering.counterLength} onChange={v => setSection("numbering", { counterLength: Math.min(8, Math.max(4, v)) })} min={4} max={8} />
          </SectionCard>

          <SectionCard title="Return Policy">
            <NumberRow label="Return Window (days)" value={config.policy.returnWindowDays} onChange={v => setSection("policy", { returnWindowDays: Math.max(0, v) })} min={0} />
            <p className="text-[11px] text-slate-400 pb-2">Set to 0 to disable the return time limit.</p>
          </SectionCard>
        </div>
      );

      // ── Custom Fields ────────────────────────────────────────────
      case "custom": return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-slate-500">Add pharmacy-specific fields like Membership No, Hospital ID, Insurance Number.</p>
            <button
              onClick={addCustomField}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
              Add Field
            </button>
          </div>

          {config.customFields.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-[13px]">
              No custom fields yet. Click "Add Field" to create one.
            </div>
          )}

          {config.customFields.map(field => (
            <div key={field.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between mb-2">
                <input
                  value={field.label}
                  onChange={e => updateCustomField(field.id, { label: e.target.value })}
                  className="text-[13px] font-semibold text-slate-700 bg-transparent border-b border-dashed border-slate-300 focus:outline-none focus:border-blue-400 flex-1 mr-2"
                />
                <div className="flex items-center gap-2">
                  <button onClick={() => updateCustomField(field.id, { show: !field.show })}
                    className={cn("text-[11px] font-semibold px-2 py-1 rounded-lg border transition-colors",
                      field.show ? "bg-blue-50 text-blue-600 border-blue-200" : "bg-slate-50 text-slate-400 border-slate-200"
                    )}>
                    {field.show ? "Visible" : "Hidden"}
                  </button>
                  <button onClick={() => removeCustomField(field.id)} className="text-slate-300 hover:text-red-500 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <SegmentRow label="Position" value={field.position} onChange={v => updateCustomField(field.id, { position: v })}
                options={[{ value: "header", label: "Header" }, { value: "footer", label: "Footer" }]} />
            </div>
          ))}
        </div>
      );
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">

      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3.5 bg-white border-b border-slate-200 flex-shrink-0">
        <div>
          <h1 className="text-[17px] font-bold text-slate-900">Invoice Settings</h1>
          <p className="text-[12px] text-slate-400 mt-0.5">Customise how your invoices look and behave</p>
        </div>

        <div className="flex items-center gap-3">
          <AnimatePresence>
            {saved && (
              <motion.span
                initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600"
              >
                <CheckCircle2 className="w-4 h-4" />Saved
              </motion.span>
            )}
          </AnimatePresence>

          {error && (
            <span className="text-[12px] text-red-500 font-medium">{error}</span>
          )}

          <button
            onClick={() => {
              if (!window.confirm("Reset all invoice settings to defaults? This cannot be undone.")) return;
              setConfig(mergeDefaults({}));
            }}
            className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500 border border-slate-200 hover:bg-slate-50 rounded-lg px-3 py-1.5 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reset
          </button>

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-[13px] font-bold px-4 py-1.5 rounded-lg transition-colors shadow-sm"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save Changes
          </button>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: section nav + content */}
        <div className="flex border-r border-slate-200 bg-white" style={{ width: "500px", flexShrink: 0 }}>

          {/* Section tabs */}
          <div className="w-40 flex-shrink-0 border-r border-slate-100 overflow-y-auto py-3 bg-slate-50/50">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={cn(
                  "w-full text-left px-3.5 py-2.5 text-[12px] font-medium transition-colors relative",
                  activeSection === s.id
                    ? "text-blue-700 bg-white border-r-2 border-blue-600 font-semibold"
                    : "text-slate-600 hover:text-slate-800 hover:bg-white/60"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Section content */}
          <div className="flex-1 overflow-y-auto p-5 min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
              >
                {renderSection()}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Right: live preview */}
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-100">
          {/* Preview toolbar */}
          <div className="flex items-center gap-3 px-5 py-2.5 bg-white border-b border-slate-200 flex-shrink-0">
            <Eye className="w-4 h-4 text-slate-400" strokeWidth={1.8} />
            <span className="text-[13px] font-semibold text-slate-600">Live Preview</span>
            <span className="ml-auto text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full font-medium">
              {config.paper.size} · {config.theme}
            </span>
          </div>

          {/* Scaled preview */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden flex items-start justify-center p-8">
            {isThermal ? (
              <div className="shadow-2xl rounded-sm overflow-hidden">
                <ThermalReceiptView invoice={MOCK_INVOICE} config={config} />
              </div>
            ) : (
              <div
                style={{
                  transform: "scale(0.54)",
                  transformOrigin: "top center",
                  width: `${100 / 0.54}%`,
                  pointerEvents: "none",
                }}
              >
                <div className="flex justify-center">
                  <div className="shadow-2xl">
                    <InvoicePrintView invoice={MOCK_INVOICE} config={config} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
