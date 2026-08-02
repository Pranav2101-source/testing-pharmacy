import { useState, useEffect } from "react";
import { api } from "./api-client";
import { defaultInvoiceSettings, normalizeInvoiceSettings } from "@pharmacy/types";
import type { InvoiceSettingsConfig } from "@pharmacy/types";
import type { PharmacyProfile } from "@/components/billing/InvoicePrintView";

type InvoicePrintConfig = {
  config:   InvoiceSettingsConfig;
  pharmacy: PharmacyProfile | undefined;
  loading:  boolean;
};

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
        cachedConfig   = normalizeInvoiceSettings(settingsRaw);
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
