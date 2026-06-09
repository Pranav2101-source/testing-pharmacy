// ─── Invoice Template Config ──────────────────────────────────────────────────
// Stored as JSON in InvoiceSettings.settings (per pharmacy).
// All sections are independently versioned; missing sections fall back to
// defaults so old stored configs remain valid after schema changes.

export type InvoiceTheme  = "classic" | "modern" | "minimal";
export type PaperSize     = "A4" | "A5" | "thermal80" | "thermal58";
export type LogoPosition  = "left" | "center" | "right";
export type LogoSize      = "small" | "medium" | "large";
export type HeaderAlign   = "left" | "center" | "right";

export type CustomField = {
  id:       string;
  label:    string;
  show:     boolean;
  position: "header" | "footer";
};

export type InvoiceSettingsConfig = {
  // ── Theme & Paper ──────────────────────────────────────────────────────────
  theme: InvoiceTheme;
  paper: {
    size: PaperSize;
  };

  // ── Branding ───────────────────────────────────────────────────────────────
  branding: {
    showLogo:             boolean;
    logoUrl:              string | null;
    logoPosition:         LogoPosition;
    logoSize:             LogoSize;
    primaryColor:         string;   // hex
    pharmacyNameOverride: string;   // empty = use real name from DB
    watermarkText:        string;   // e.g. "DUPLICATE" — empty = none
    pharmacyNameStyle:    "normal" | "bold" | "italic";
  };

  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    align:           HeaderAlign;
    showName:        boolean;
    showAddress:     boolean;
    showPhone:       boolean;
    showEmail:       boolean;
    showWebsite:     boolean;
    showGstin:       boolean; // 🔒 GST required
    showDrugLicense: boolean;
    showFssai:       boolean;
    customText:      string;
  };

  // ── Patient / Transaction ──────────────────────────────────────────────────
  patient: {
    showName:           boolean;
    showMobile:         boolean;
    showAddress:        boolean;
    showUhid:           boolean;
    showAbha:           boolean;
    showDoctor:         boolean;
    showPrescriptionNo: boolean;
    showInvoiceDate:    boolean;
    showCashier:        boolean;
  };

  // ── Medicine Table Columns ─────────────────────────────────────────────────
  columns: {
    showHsn:      boolean; // 🔒 GST required
    showBatch:    boolean;
    showExpiry:   boolean;
    showFreeQty:  boolean;
    showMrp:      boolean;
    showRate:     boolean;
    showDiscount: boolean;
    showGstRate:  boolean; // 🔒 GST required
    showTaxable:  boolean; // 🔒 GST required
  };

  // ── Financial Summary ──────────────────────────────────────────────────────
  totals: {
    showSubtotal:     boolean;
    showDiscount:     boolean;
    showSavings:      boolean;
    showTaxable:      boolean; // 🔒 GST required
    showCgst:         boolean; // 🔒 GST required
    showSgst:         boolean; // 🔒 GST required
    showIgst:         boolean; // 🔒 GST required (interstate)
    showGstBreakdown: boolean; // 🔒 GST required
    showRoundOff:     boolean;
    showPaymentMode:  boolean;
    showAmountWords:  boolean;
  };

  // ── Footer ─────────────────────────────────────────────────────────────────
  footer: {
    thankYouText:   string;
    terms:          string;
    showSignature:  boolean;
    signatureLabel: string;
    showQrCode:     boolean;
    upiId:          string;
    contactInfo:    string;
  };

  // ── Numbering ──────────────────────────────────────────────────────────────
  numbering: {
    prefix:             string;   // "INV", "BILL", "RX", custom
    financialYear:      string;   // "2025-26" — empty string = no FY in number
    separator:          string;   // "/" or "-"
    counterLength:      number;   // 4–8 digits
    currentSequence:    number;   // managed by Redis; not editable from UI
  };

  // ── Custom Fields ──────────────────────────────────────────────────────────
  customFields: CustomField[];

  // ── Policy ─────────────────────────────────────────────────────────────────
  policy: {
    returnWindowDays: number;
  };
};

// ─── GST-locked fields (cannot be disabled) ───────────────────────────────────
// These fields are mandatory under GST rules for registered pharmacies.

export const GST_LOCKED_FIELDS = {
  "header.showGstin":       "GSTIN is mandatory on all GST invoices",
  "columns.showHsn":        "HSN code is required for GST invoices",
  "columns.showGstRate":    "GST rate must be shown per line item",
  "columns.showTaxable":    "Taxable value is required by GST rules",
  "totals.showTaxable":     "Total taxable amount is required",
  "totals.showCgst":        "CGST amount must be declared",
  "totals.showSgst":        "SGST amount must be declared",
  "totals.showIgst":        "IGST must be shown for interstate transactions",
  "totals.showGstBreakdown":"GST slab-wise breakup is required",
} as const;

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const defaultInvoiceSettings: InvoiceSettingsConfig = {
  theme: "classic",
  paper: { size: "A4" },

  branding: {
    showLogo:             false,
    logoUrl:              null,
    logoPosition:         "left",
    logoSize:             "medium",
    primaryColor:         "#1a3080",
    pharmacyNameOverride: "",
    watermarkText:        "",
    pharmacyNameStyle:    "bold",
  },

  header: {
    align:           "center",
    showName:        true,
    showAddress:     true,
    showPhone:       true,
    showEmail:       false,
    showWebsite:     false,
    showGstin:       true,
    showDrugLicense: true,
    showFssai:       false,
    customText:      "",
  },

  patient: {
    showName:           true,
    showMobile:         true,
    showAddress:        false,
    showUhid:           false,
    showAbha:           false,
    showDoctor:         true,
    showPrescriptionNo: false,
    showInvoiceDate:    true,
    showCashier:        false,
  },

  columns: {
    showHsn:      true,
    showBatch:    true,
    showExpiry:   true,
    showFreeQty:  false,
    showMrp:      true,
    showRate:     true,
    showDiscount: true,
    showGstRate:  true,
    showTaxable:  true,
  },

  totals: {
    showSubtotal:     true,
    showDiscount:     true,
    showSavings:      true,
    showTaxable:      true,
    showCgst:         true,
    showSgst:         true,
    showIgst:         true,
    showGstBreakdown: true,
    showRoundOff:     true,
    showPaymentMode:  true,
    showAmountWords:  true,
  },

  footer: {
    thankYouText:   "Thank you for your visit. Get well soon!",
    terms:          "Medicines once sold cannot be returned.\nThis is a computer-generated invoice.",
    showSignature:  false,
    signatureLabel: "Authorized Pharmacist",
    showQrCode:     false,
    upiId:          "",
    contactInfo:    "",
  },

  numbering: {
    prefix:          "INV",
    financialYear:   "2025-26",
    separator:       "/",
    counterLength:   6,
    currentSequence: 1,
  },

  customFields: [],

  policy: {
    returnWindowDays: 30,
  },
};
