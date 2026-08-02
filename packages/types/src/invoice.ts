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
    /**
     * Default. The financial year is computed from the current IST date and rolls
     * over automatically on 1 April, so a number issued in FY 2026-27 says so
     * without anyone remembering to edit a setting.
     *
     * Set false to pin `financialYear` to a literal value — needed for data
     * migration, backdated invoices, and testing, where the number has to carry a
     * year other than today's.
     */
    autoFinancialYear:  boolean;
    /** Literal FY, used only when `autoFinancialYear` is false. Empty = omit the year. */
    financialYear:      string;
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

// ─── Normalisation ────────────────────────────────────────────────────────────

/**
 * Fills a stored (possibly partial, possibly old) config out to a complete one and
 * re-asserts the GST-mandatory fields.
 *
 * <p>THE SINGLE PLACE THIS HAPPENS. It previously existed as three near-copies —
 * in the settings page, in the print-config hook, and inside InvoicePrintView —
 * and the third had drifted: it merged defaults but did NOT force the
 * {@link GST_LOCKED_FIELDS} back on. That copy is what renders the actual bill, so
 * a stored config carrying `showHsn: false` (written before the lock existed, or
 * hand-edited) would have printed a GST invoice with no HSN column while the
 * settings screen showed the toggle as locked on.
 *
 * <p>Forcing the locked fields on read, not just on write, is deliberate: it means
 * a non-compliant invoice cannot be produced regardless of what is in the database.
 */
export function normalizeInvoiceSettings(
  partial: Partial<InvoiceSettingsConfig> | null | undefined,
): InvoiceSettingsConfig {
  const p = partial ?? {};
  return {
    ...defaultInvoiceSettings,
    ...p,
    branding:  { ...defaultInvoiceSettings.branding, ...p.branding },
    header:    { ...defaultInvoiceSettings.header,   ...p.header,   showGstin: true },
    patient:   { ...defaultInvoiceSettings.patient,  ...p.patient  },
    columns:   {
      ...defaultInvoiceSettings.columns, ...p.columns,
      showHsn: true, showGstRate: true, showTaxable: true,
    },
    totals:    {
      ...defaultInvoiceSettings.totals, ...p.totals,
      showTaxable: true, showCgst: true, showSgst: true, showIgst: true, showGstBreakdown: true,
    },
    footer:    { ...defaultInvoiceSettings.footer,    ...p.footer    },
    numbering: { ...defaultInvoiceSettings.numbering, ...p.numbering },
    paper:     { ...defaultInvoiceSettings.paper,     ...p.paper     },
    policy:    { ...defaultInvoiceSettings.policy,    ...p.policy    },
    customFields: p.customFields ?? defaultInvoiceSettings.customFields,
  };
}

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
    prefix:            "INV",
    autoFinancialYear: true,
    // Ignored while autoFinancialYear is true; kept blank so switching the toggle
    // off does not silently resurrect a hardcoded year from a previous release.
    financialYear:     "",
    separator:         "/",
    counterLength:     6,
    currentSequence:   1,
  },

  customFields: [],

  policy: {
    returnWindowDays: 30,
  },
};
