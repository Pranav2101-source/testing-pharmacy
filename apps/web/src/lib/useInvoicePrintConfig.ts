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

// Components currently mounted with this hook. `invalidate...` pings them so a
// billing screen that is already open picks up a settings save without a reload.
const subscribers = new Set<() => void>();

export function invalidateInvoicePrintConfigCache() {
  cachedConfig   = undefined;
  cachedPharmacy = undefined;
  fetchPromise   = null;
  subscribers.forEach((notify) => {
    try { notify(); } catch { /* a dead subscriber must not block the rest */ }
  });
}

function loadInvoicePrintConfig(): Promise<void> {
  if (cachedConfig && cachedPharmacy) return Promise.resolve();
  if (!fetchPromise) {
    fetchPromise = Promise.all([
      api.get("/billing/settings").then(r => r.data.data as unknown),
      api.get("/pharmacy").then(r => r.data.data as PharmacyProfile | null),
    ]).then(([settingsRaw, pharmacyRaw]) => {
      // normalizeInvoiceSettings treats the stored blob as untrusted: partial,
      // legacy-schema, hand-edited or malformed all resolve to a complete config.
      cachedConfig   = normalizeInvoiceSettings(settingsRaw as Partial<InvoiceSettingsConfig> | null);
      cachedPharmacy = pharmacyRaw ?? undefined;
    }).catch(() => {
      // On failure keep defaults; allow the next attempt to retry.
      fetchPromise = null;
    });
  }
  return fetchPromise;
}

export function useInvoicePrintConfig(): InvoicePrintConfig {
  const [config,   setConfig]   = useState<InvoiceSettingsConfig>(cachedConfig ?? defaultInvoiceSettings);
  const [pharmacy, setPharmacy] = useState<PharmacyProfile | undefined>(cachedPharmacy ?? undefined);
  const [loading,  setLoading]  = useState(!cachedConfig);
  // Bumped by `invalidateInvoicePrintConfigCache` — re-runs the effect below.
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    const notify = () => setRefreshNonce((n) => n + 1);
    subscribers.add(notify);
    return () => { subscribers.delete(notify); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!cachedConfig) setLoading(true);
    loadInvoicePrintConfig().then(() => {
      if (cancelled) return;
      setConfig(cachedConfig ?? defaultInvoiceSettings);
      setPharmacy(cachedPharmacy ?? undefined);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [refreshNonce]);

  return { config, pharmacy, loading };
}
