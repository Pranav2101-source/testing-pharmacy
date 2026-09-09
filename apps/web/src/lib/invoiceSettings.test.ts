import { describe, expect, it } from "vitest";
import {
  defaultInvoiceSettings,
  normalizeInvoiceSettings,
  enforceGstLockedFields,
  CURRENT_SCHEMA_VERSION,
  GST_LOCKED_FIELDS,
  type InvoiceSettingsConfig,
} from "@pharmacy/types";

/**
 * `normalizeInvoiceSettings` is the single point where a stored invoice config is
 * turned into one the app can render from. Two jobs:
 *
 *  1. Fill out a partial or outdated stored config so nothing downstream reads
 *     `undefined` — these blobs are persisted JSON that outlive schema changes.
 *  2. Re-assert the GST-mandatory fields on READ, so a config that somehow has
 *     them switched off still produces a compliant invoice.
 *
 * Job 2 is the reason this lives in one place. Three near-copies of this merge
 * existed and the one inside InvoicePrintView — the component that renders the
 * actual bill — had drifted and did not enforce the locks.
 */

describe("filling out partial configs", () => {
  it("returns the full defaults for an empty object", () => {
    expect(normalizeInvoiceSettings({})).toEqual(defaultInvoiceSettings);
  });

  it("returns the full defaults for null and undefined", () => {
    // The API returns null for a pharmacy that never configured anything.
    expect(normalizeInvoiceSettings(null)).toEqual(defaultInvoiceSettings);
    expect(normalizeInvoiceSettings(undefined)).toEqual(defaultInvoiceSettings);
  });

  it("keeps a stored value and fills the rest of its section", () => {
    const result = normalizeInvoiceSettings({ footer: { thankYouText: "Visit again" } as never });

    expect(result.footer.thankYouText).toBe("Visit again");
    expect(result.footer.terms).toBe(defaultInvoiceSettings.footer.terms);
    expect(result.footer.signatureLabel).toBe(defaultInvoiceSettings.footer.signatureLabel);
  });

  it("fills sections that are missing entirely", () => {
    // A config saved before a section existed must not leave that section undefined
    // — every print view reads these without optional chaining.
    const result = normalizeInvoiceSettings({ theme: "modern" });

    expect(result.branding).toEqual(defaultInvoiceSettings.branding);
    expect(result.patient).toEqual(defaultInvoiceSettings.patient);
    expect(result.numbering).toEqual(defaultInvoiceSettings.numbering);
    expect(result.policy).toEqual(defaultInvoiceSettings.policy);
    expect(result.theme).toBe("modern");
  });

  it("fills the bank section for a config saved before it existed", () => {
    // TaxWholesaleInvoiceView reads config.bank.* without optional chaining.
    const result = normalizeInvoiceSettings({ theme: "tax-wholesale" });
    expect(result.bank).toEqual(defaultInvoiceSettings.bank);
    expect(result.theme).toBe("tax-wholesale");
  });

  it("keeps stored bank details and fills the rest", () => {
    const result = normalizeInvoiceSettings({ bank: { show: true, ifsc: "SBIN0000123" } as never });
    expect(result.bank.show).toBe(true);
    expect(result.bank.ifsc).toBe("SBIN0000123");
    expect(result.bank.bankName).toBe("");
  });

  it("keeps the new patient toggles under the pharmacy's control", () => {
    const result = normalizeInvoiceSettings({
      patient: { showBuyerGstin: true, showPlaceOfSupply: false } as never,
    });
    expect(result.patient.showBuyerGstin).toBe(true);
    expect(result.patient.showPlaceOfSupply).toBe(false);
    // untouched sibling still defaults
    expect(result.patient.showName).toBe(defaultInvoiceSettings.patient.showName);
  });

  it("preserves top-level scalars", () => {
    const result = normalizeInvoiceSettings({ theme: "minimal", paper: { size: "thermal58" } });
    expect(result.theme).toBe("minimal");
    expect(result.paper.size).toBe("thermal58");
  });

  it("keeps custom fields, defaulting to an empty list", () => {
    expect(normalizeInvoiceSettings({}).customFields).toEqual([]);

    const fields = [{ id: "a", label: "Ward", show: true, position: "header" as const }];
    expect(normalizeInvoiceSettings({ customFields: fields }).customFields).toEqual(fields);
  });

  it("does not mutate the defaults object", () => {
    // A shared module-level constant leaking mutations would corrupt every
    // subsequent render in the session.
    const before = JSON.stringify(defaultInvoiceSettings);
    const result = normalizeInvoiceSettings({ footer: { thankYouText: "changed" } as never });
    result.footer.terms = "mutated";

    expect(JSON.stringify(defaultInvoiceSettings)).toBe(before);
  });
});

describe("GST-mandatory fields are re-asserted on read", () => {
  // A GST tax invoice in India must carry the GSTIN, per-line HSN, per-line GST
  // rate and taxable value, and the slab-wise tax breakup. The settings screen
  // renders these toggles locked; this is what makes that true of the output too.
  const allOff: Partial<InvoiceSettingsConfig> = {
    header:  { showGstin: false } as never,
    columns: { showHsn: false, showGstRate: false, showTaxable: false } as never,
    totals:  {
      showTaxable: false, showCgst: false, showSgst: false,
      showIgst: false, showGstBreakdown: false,
    } as never,
  };

  it("forces GSTIN back on", () => {
    expect(normalizeInvoiceSettings(allOff).header.showGstin).toBe(true);
  });

  it("forces the mandatory line-item columns back on", () => {
    const c = normalizeInvoiceSettings(allOff).columns;
    expect(c.showHsn).toBe(true);
    expect(c.showGstRate).toBe(true);
    expect(c.showTaxable).toBe(true);
  });

  it("forces the mandatory tax totals back on", () => {
    const t = normalizeInvoiceSettings(allOff).totals;
    expect(t.showTaxable).toBe(true);
    expect(t.showCgst).toBe(true);
    expect(t.showSgst).toBe(true);
    expect(t.showIgst).toBe(true);
    expect(t.showGstBreakdown).toBe(true);
  });

  it("covers every field listed in GST_LOCKED_FIELDS", () => {
    // Guards the list and the implementation against drifting apart: adding a
    // locked field without enforcing it here fails this test.
    const normalized = normalizeInvoiceSettings(allOff) as unknown as Record<
      string, Record<string, unknown>
    >;
    for (const path of Object.keys(GST_LOCKED_FIELDS)) {
      const [section, field] = path.split(".");
      expect(normalized[section!]![field!], `${path} must be forced on`).toBe(true);
    }
  });

  it("leaves NON-locked toggles under the pharmacy's control", () => {
    // The lock must be narrow. Turning off batch/expiry/discount columns is a
    // legitimate choice and must survive normalisation.
    const result = normalizeInvoiceSettings({
      columns: { showBatch: false, showExpiry: false, showDiscount: false } as never,
      totals:  { showSavings: false, showAmountWords: false } as never,
      header:  { showPhone: false, showFssai: false } as never,
    });

    expect(result.columns.showBatch).toBe(false);
    expect(result.columns.showExpiry).toBe(false);
    expect(result.columns.showDiscount).toBe(false);
    expect(result.totals.showSavings).toBe(false);
    expect(result.totals.showAmountWords).toBe(false);
    expect(result.header.showPhone).toBe(false);
    expect(result.header.showFssai).toBe(false);
  });
});

describe("numbering and policy survive normalisation", () => {
  // These two sections are the ones the SERVER also reads (invoice number and
  // return window), so a value lost here would desync the preview from the bill.
  it("keeps a configured number format", () => {
    const result = normalizeInvoiceSettings({
      numbering: { prefix: "BILL", separator: "-", counterLength: 4, financialYear: "2025-26" } as never,
    });

    expect(result.numbering.prefix).toBe("BILL");
    expect(result.numbering.separator).toBe("-");
    expect(result.numbering.counterLength).toBe(4);
    expect(result.numbering.financialYear).toBe("2025-26");
  });

  it("defaults the financial year to AUTO", () => {
    // Auto is the normal case: the year is computed per bill and rolls over on
    // 1 April without anyone editing a setting.
    expect(normalizeInvoiceSettings({}).numbering.autoFinancialYear).toBe(true);
  });

  it("keeps a manual override switched off", () => {
    // The escape hatch for migration, backdated invoices and testing. Must survive
    // normalisation or the override silently reverts to auto.
    const result = normalizeInvoiceSettings({
      numbering: { autoFinancialYear: false, financialYear: "2019-20" } as never,
    });
    expect(result.numbering.autoFinancialYear).toBe(false);
    expect(result.numbering.financialYear).toBe("2019-20");
  });

  it("keeps an explicitly empty financial year under a manual override", () => {
    // Empty under an override means "leave the year out of the number" — a real
    // choice. Falling back to the default here would silently re-add it.
    const result = normalizeInvoiceSettings({
      numbering: { autoFinancialYear: false, financialYear: "" } as never,
    });
    expect(result.numbering.autoFinancialYear).toBe(false);
    expect(result.numbering.financialYear).toBe("");
  });

  it("a config written before the flag existed normalises to AUTO", () => {
    // Backward compatibility: an old blob carrying only a literal year must not
    // pin that year forever once April rolls around.
    const result = normalizeInvoiceSettings({
      numbering: { prefix: "BILL", financialYear: "2019-20" } as never,
    });
    expect(result.numbering.autoFinancialYear).toBe(true);
  });

  it("keeps a zero return window, which means the limit is switched off", () => {
    // Must not be treated as missing and replaced with the 30-day default.
    const result = normalizeInvoiceSettings({ policy: { returnWindowDays: 0 } });
    expect(result.policy.returnWindowDays).toBe(0);
  });

  it("keeps a custom return window", () => {
    expect(normalizeInvoiceSettings({ policy: { returnWindowDays: 15 } }).policy.returnWindowDays).toBe(15);
  });
});

// ─── Migration & fallback guard (zero data loss) ──────────────────────────────

describe("deep merge — never crashes, never drops a preference", () => {
  it("stamps the current schema version on every read", () => {
    expect(normalizeInvoiceSettings({}).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(normalizeInvoiceSettings(null).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(normalizeInvoiceSettings({ schemaVersion: 1 } as never).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("survives a completely malformed stored value", () => {
    // Postgres' json column would reject invalid syntax, but a valid-JSON value of
    // the wrong TYPE can still land there (a bad migration, a hand edit).
    for (const junk of ["nonsense", 42, true, [1, 2, 3], "", "null"] as unknown[]) {
      expect(() => normalizeInvoiceSettings(junk as never)).not.toThrow();
      expect(normalizeInvoiceSettings(junk as never)).toEqual(defaultInvoiceSettings);
    }
  });

  it("a section stored with the wrong type falls back to its default, siblings survive", () => {
    const result = normalizeInvoiceSettings({
      totals: "corrupt" as never,
      footer: { thankYouText: "See you soon" } as never,
      branding: [] as never,
    });
    expect(result.totals).toEqual(defaultInvoiceSettings.totals);
    expect(result.branding).toEqual(defaultInvoiceSettings.branding);
    expect(result.footer.thankYouText).toBe("See you soon");           // kept
    expect(result.footer.terms).toBe(defaultInvoiceSettings.footer.terms); // backfilled
  });

  it("a leaf stored with the wrong primitive type falls back", () => {
    const result = normalizeInvoiceSettings({
      numbering: { prefix: "BILL", counterLength: "8" } as never, // string where number expected
      branding: { primaryColor: 123, watermarkText: "DUPLICATE" } as never,
    });
    expect(result.numbering.prefix).toBe("BILL");                        // kept
    expect(result.numbering.counterLength).toBe(defaultInvoiceSettings.numbering.counterLength); // rejected
    expect(result.branding.primaryColor).toBe(defaultInvoiceSettings.branding.primaryColor);    // rejected
    expect(result.branding.watermarkText).toBe("DUPLICATE");             // kept
  });

  it("keeps a nullable field set either way", () => {
    expect(normalizeInvoiceSettings({ branding: { logoUrl: "https://x/logo.png" } as never }).branding.logoUrl)
      .toBe("https://x/logo.png");
    expect(normalizeInvoiceSettings({ branding: { logoUrl: null } as never }).branding.logoUrl).toBeNull();
  });

  it("carries an optional stored-only key through (paper.marginMm has no default)", () => {
    const result = normalizeInvoiceSettings({ paper: { size: "A5", marginMm: 6, contentScale: 1.1 } as never });
    expect(result.paper.size).toBe("A5");
    expect(result.paper.marginMm).toBe(6);
    expect(result.paper.contentScale).toBe(1.1);
  });

  it("carries an unknown section from a NEWER client through untouched (forward-compat)", () => {
    const result = normalizeInvoiceSettings({ futureSection: { enabled: true } } as never) as Record<string, unknown>;
    expect(result.futureSection).toEqual({ enabled: true });
    expect(result.header).toEqual(normalizeInvoiceSettings({}).header); // known sections still filled
  });

  it("does not share mutable state with the defaults", () => {
    const before = JSON.stringify(defaultInvoiceSettings);
    const a = normalizeInvoiceSettings({});
    a.footer.terms = "mutated";
    a.columns.showBatch = false;
    (a.customFields as unknown[]).push({ id: "x", label: "X", show: true, position: "header" });
    expect(JSON.stringify(defaultInvoiceSettings)).toBe(before);
  });
});

describe("legacy v1 config → migrated forward with every preference intact", () => {
  // A realistic blob written by the app BEFORE this round: no schemaVersion, no
  // `bank` section, no `theme: "tax-wholesale"`, no `paper.marginMm`, no
  // `patient.showBuyerGstin` / `showPlaceOfSupply`, and several deliberate
  // customisations the pharmacy made.
  const V1: Record<string, unknown> = {
    theme: "classic",
    paper: { size: "A4" },
    branding: { primaryColor: "#0a7d34", pharmacyNameOverride: "Sri Sai Medicals", pharmacyNameStyle: "italic" },
    header: { align: "left", showFssai: true, showEmail: true },
    patient: { showCashier: true, showPrescriptionNo: true },
    columns: { showFreeQty: true, showBatch: false },
    totals: { showSavings: false, showRoundOff: false },
    footer: { thankYouText: "Dhanyavaad!", terms: "No returns.\nExchange within 24h.", showSignature: true },
    numbering: { prefix: "SSM", separator: "-", counterLength: 5, autoFinancialYear: false, financialYear: "2024-25" },
    customFields: [{ id: "ward", label: "Ward / Bed", show: true, position: "header" }],
    policy: { returnWindowDays: 7 },
  };

  const migrated = normalizeInvoiceSettings(V1);

  it("bumps the schema version", () => {
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("keeps EVERY v1 preference", () => {
    expect(migrated.branding.primaryColor).toBe("#0a7d34");
    expect(migrated.branding.pharmacyNameOverride).toBe("Sri Sai Medicals");
    expect(migrated.branding.pharmacyNameStyle).toBe("italic");
    expect(migrated.header.align).toBe("left");
    expect(migrated.header.showFssai).toBe(true);
    expect(migrated.patient.showCashier).toBe(true);
    expect(migrated.columns.showFreeQty).toBe(true);
    expect(migrated.columns.showBatch).toBe(false);
    expect(migrated.totals.showSavings).toBe(false);
    expect(migrated.totals.showRoundOff).toBe(false);
    expect(migrated.footer.thankYouText).toBe("Dhanyavaad!");
    expect(migrated.footer.terms).toBe("No returns.\nExchange within 24h.");
    expect(migrated.footer.showSignature).toBe(true);
    expect(migrated.numbering.prefix).toBe("SSM");
    expect(migrated.numbering.counterLength).toBe(5);
    expect(migrated.numbering.autoFinancialYear).toBe(false);
    expect(migrated.numbering.financialYear).toBe("2024-25");
    expect(migrated.customFields).toEqual([{ id: "ward", label: "Ward / Bed", show: true, position: "header" }]);
    expect(migrated.policy.returnWindowDays).toBe(7);
  });

  it("backfills the v2 additions with their defaults", () => {
    expect(migrated.bank).toEqual(defaultInvoiceSettings.bank);
    expect(migrated.patient.showBuyerGstin).toBe(false);
    expect(migrated.patient.showPlaceOfSupply).toBe(true);
  });

  it("still re-asserts the GST-locked fields", () => {
    expect(migrated.columns.showHsn).toBe(true);
    expect(migrated.totals.showCgst).toBe(true);
    expect(migrated.header.showGstin).toBe(true);
  });
});

describe("enforceGstLockedFields — the write-path guarantee", () => {
  it("forces every GST-locked field on before the payload is sent", () => {
    const tampered = {
      ...defaultInvoiceSettings,
      header:  { ...defaultInvoiceSettings.header,  showGstin: false },
      columns: { ...defaultInvoiceSettings.columns, showHsn: false, showGstRate: false, showTaxable: false },
      totals:  {
        ...defaultInvoiceSettings.totals,
        showTaxable: false, showCgst: false, showSgst: false, showIgst: false, showGstBreakdown: false,
      },
    } as InvoiceSettingsConfig;

    const safe = enforceGstLockedFields(tampered);
    for (const path of Object.keys(GST_LOCKED_FIELDS)) {
      const [section, field] = path.split(".");
      expect((safe as unknown as Record<string, Record<string, unknown>>)[section!]![field!]).toBe(true);
    }
    expect(safe.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
});
