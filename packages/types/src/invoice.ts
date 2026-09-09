// ─── Invoice Template Config ──────────────────────────────────────────────────
// Stored as JSON in Pharmacy.invoiceSettings (per pharmacy). The stored blob is
// treated as UNTRUSTED input on every read: it may be partial, from an older
// schema, hand-edited, or corrupt. `normalizeInvoiceSettings` deep-merges it over
// the defaults, migrates old versions forward, drops nothing the pharmacy set,
// and never throws — see that function.

/** Bump when the config SHAPE changes in a way a migration step must handle. */
export const CURRENT_SCHEMA_VERSION = 2;

export type InvoiceTheme  = "classic" | "modern" | "minimal" | "tax-wholesale";
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
  /**
   * Schema version of this config. Written by {@link normalizeInvoiceSettings} on
   * every read/save; a stored blob without it (or with a lower number) is treated
   * as that older version and migrated forward. Never edited from the UI.
   */
  schemaVersion: number;

  // ── Theme & Paper ──────────────────────────────────────────────────────────
  theme: InvoiceTheme;
  paper: {
    size: PaperSize;
    /**
     * Page margin in millimetres for the A4/A5 page formats (classic + tax-
     * wholesale). Clamped 4–25 on render; falls back to the per-size default when
     * absent. Thermal ignores it — a receipt roll's printable width is fixed by
     * the hardware. Optional so a config saved before it existed stays valid.
     */
    marginMm?: number;
    /**
     * Content zoom for the tax-wholesale layout: 0.75–1.25, 1 = the designed
     * size. Scales every text size and gap together so a pharmacy can fit a long
     * bill on one page or make a short one more readable.
     */
    contentScale?: number;
    /**
     * Tax-wholesale layout only: the item grid is blank-padded to at least this
     * many rows so the page keeps a constant height. Clamped 0–20. 0 = no padding.
     */
    minRows?: number;
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
    /** Buyer's GSTIN + a "Wholesale Details" block — for B2B / wholesale bills. */
    showBuyerGstin:     boolean;
    /** "Place of Supply" line (the destination state) — GST practice on tax invoices. */
    showPlaceOfSupply:  boolean;
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

  // ── Bank & Payment ─────────────────────────────────────────────────────────
  // Printed as a "Bank Details" box on the tax-wholesale layout. Held here in the
  // settings blob (pharmacy-wide) rather than on the Pharmacy row — it only ever
  // appears on an invoice and never needs to be queried.
  bank: {
    show:          boolean;
    bankName:      string;
    accountNumber: string;
    ifsc:          string;
    branch:        string;
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

// ─── Normalisation, deep-merge & migration ────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function safeClone<T>(v: T): T {
  try {
    return typeof structuredClone === "function"
      ? structuredClone(v)
      : JSON.parse(JSON.stringify(v));
  } catch {
    return v;
  }
}

/**
 * Recursively merges an untrusted stored value over a known-good default.
 *
 * Rules, in order:
 *  - default is an array  → replace only with another array, else keep default
 *  - default is a leaf    → keep the stored value when it is type-compatible
 *    (same `typeof`, or either side is `null` for a nullable field); a structural
 *    mismatch (object/array where a string was expected, "8" where 8 was) keeps
 *    the default rather than poisoning the render
 *  - default is an object → fresh object, merge the UNION of keys: recurse where
 *    the default has the key, and carry stored-only keys (e.g. `paper.marginMm`,
 *    or a whole section added by a newer client) through verbatim
 *
 * Every object in the result is freshly constructed, so the returned config
 * shares no mutable state with `defaultInvoiceSettings` or the caller's input.
 */
function deepMergeConfig(base: unknown, stored: unknown): unknown {
  if (Array.isArray(base)) {
    return Array.isArray(stored) ? safeClone(stored) : safeClone(base);
  }
  if (!isPlainObject(base)) {
    if (stored === undefined) return base;
    if (isPlainObject(stored) || Array.isArray(stored)) return base;
    if (base === null || stored === null) return stored;
    return typeof stored === typeof base ? stored : base;
  }
  const src = isPlainObject(stored) ? stored : {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(base)) {
    out[key] = deepMergeConfig(base[key], src[key]);
  }
  for (const key of Object.keys(src)) {
    if (!(key in base) && src[key] !== undefined) {
      out[key] = safeClone(src[key]);
    }
  }
  return out;
}

/**
 * Coerces whatever the database handed back into a safe object and walks it
 * forward to {@link CURRENT_SCHEMA_VERSION}. Never throws.
 *
 * A blob with no `schemaVersion` is the original v1 shape. v1 → v2 only ADDED
 * fields (`theme: "tax-wholesale"`, the `bank` section, `paper.marginMm` /
 * `contentScale` / `minRows`, `patient.showBuyerGstin` / `showPlaceOfSupply`), so
 * the deep-merge backfills them and there is nothing to rewrite here — the block
 * is kept so the next breaking change has an obvious home.
 */
function migrateStoredSettings(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};
  const stored: Record<string, unknown> = { ...raw };

  const version =
    typeof stored.schemaVersion === "number" && stored.schemaVersion >= 1
      ? stored.schemaVersion
      : 1;

  if (version < 2) {
    // v1 → v2: additive only. (No field transforms.)
  }

  return stored;
}

/**
 * THE SINGLE PLACE a stored invoice config becomes a renderable one.
 *
 * <p>Two jobs, both done on READ so neither a stale nor a hand-edited blob can
 * ever reach a bill:
 *
 *  1. <b>Zero data loss on any schema change.</b> The stored JSON is migrated
 *     forward, then deep-merged over the current defaults. Missing keys, whole
 *     missing sections, an older-version blob, a partial hand edit, even a
 *     completely malformed value (a string, an array, {@code null}) all resolve
 *     to a complete, valid config — and every preference the pharmacy did set
 *     survives untouched. The pharmacy never has to reconfigure after a backend,
 *     frontend or DB change.
 *
 *  2. <b>GST compliance cannot be switched off.</b> The {@link GST_LOCKED_FIELDS}
 *     are re-asserted here regardless of what is stored, so a non-compliant
 *     invoice cannot be produced from the database.
 */
export function normalizeInvoiceSettings(
  partial: Partial<InvoiceSettingsConfig> | Record<string, unknown> | null | undefined,
): InvoiceSettingsConfig {
  const merged = deepMergeConfig(
    defaultInvoiceSettings,
    migrateStoredSettings(partial),
  ) as InvoiceSettingsConfig;

  return {
    ...merged,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    header:  { ...merged.header,  showGstin: true },
    columns: { ...merged.columns, showHsn: true, showGstRate: true, showTaxable: true },
    totals:  {
      ...merged.totals,
      showTaxable: true, showCgst: true, showSgst: true, showIgst: true, showGstBreakdown: true,
    },
    customFields: Array.isArray(merged.customFields)
      ? merged.customFields.filter((f): f is CustomField => isPlainObject(f))
      : [],
  };
}

/**
 * The compliance guarantee for the WRITE path, mirroring the read-time lock in
 * {@link normalizeInvoiceSettings}: run the outgoing payload through here so the
 * GST-mandatory fields can never be persisted as disabled, whatever the UI state.
 */
export function enforceGstLockedFields(config: InvoiceSettingsConfig): InvoiceSettingsConfig {
  return normalizeInvoiceSettings(config);
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const defaultInvoiceSettings: InvoiceSettingsConfig = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  theme: "classic",
  // marginMm / contentScale / minRows are intentionally absent: each renderer
  // applies its own per-format default (a full A4 wants a 10mm margin, an A5
  // half-sheet 4mm) and only an explicit pharmacy choice overrides it.
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
    showBuyerGstin:     false,
    showPlaceOfSupply:  true,
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

  bank: {
    show:          false,
    bankName:      "",
    accountNumber: "",
    ifsc:          "",
    branch:        "",
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
