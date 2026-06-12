import { useState, useEffect } from "react";
import { api } from "./api-client";
import { defaultInvoiceSettings } from "@pharmacy/types";
import type { InvoiceSettingsConfig } from "@pharmacy/types";
import type { PharmacyProfile } from "@/components/billing/InvoicePrintView";

type InvoicePrintConfig = {
  config:   InvoiceSettingsConfig;
  pharmacy: PharmacyProfile | undefined;
  loading:  boolean;
};

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

// Module-level cache so the same data isn't re-fetched across re-renders or
// across different components that call this hook on the same page.
let cachedConfig:   InvoiceSettingsConfig | undefined = undefined;
let cachedPharmacy: PharmacyProfile | undefined = undefined;
let fetchPromise:   Promise<void> | null = null;

export function invalidateInvoicePrintConfigCache() {
  cachedConfig   = undefined;
  cachedPharmacy = undefined;
  fetchPromise   = null;
}

export function useInvoicePrintConfig(): InvoicePrintConfig {
  const [config,   setConfig]   = useState<InvoiceSettingsConfig>(cachedConfig ?? defaultInvoiceSettings);
  const [pharmacy, setPharmacy] = useState<PharmacyProfile | undefined>(cachedPharmacy ?? undefined);
  const [loading,  setLoading]  = useState(!cachedConfig);

  useEffect(() => {
    // If already cached, nothing to do
    if (cachedConfig && cachedPharmacy) {
      setLoading(false);
      return;
    }

    // Deduplicate concurrent fetches (e.g. two components mount at the same time)
    if (!fetchPromise) {
      fetchPromise = Promise.all([
        api.get("/billing/settings").then(r => r.data.data as Partial<InvoiceSettingsConfig> | null),
        api.get("/pharmacy").then(r => r.data.data as PharmacyProfile | null),
      ]).then(([settingsRaw, pharmacyRaw]) => {
        cachedConfig   = settingsRaw ? mergeDefaults(settingsRaw) : defaultInvoiceSettings;
        cachedPharmacy = pharmacyRaw ?? undefined;
      }).catch(() => {
        // On failure keep defaults; allow next mount to retry
        fetchPromise = null;
      });
    }

    fetchPromise.then(() => {
      setConfig(cachedConfig ?? defaultInvoiceSettings);
      setPharmacy(cachedPharmacy ?? undefined);
      setLoading(false);
    });
  }, []);

  return { config, pharmacy, loading };
}
