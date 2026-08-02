import { useState, useCallback, useEffect } from "react";
import { api, getErrorMessage } from "./api-client";
import {
  Printer, FilePlus2, BookmarkCheck, MessageCircle, Mail,
  Clock3, Truck, Package, Copy, RotateCcw,
} from "lucide-react";
import type { ElementType } from "react";

export type ActionId =
  | "save_print"
  | "save_new"
  | "save_draft"
  | "whatsapp"
  | "email"
  | "credit_sale"
  | "delivery"
  | "pickup"
  | "duplicate_print"
  | "return";

export type BillingActionDef = {
  id: ActionId;
  label: string;
  description: string;
  shortcut?: string;
  /** "core" = always visible in Save dropdown by default; "extended" = lives in More Actions */
  category: "core" | "extended";
  icon: ElementType;
  iconColor: string;
  iconBg: string;
};

export const ACTION_DEFS: BillingActionDef[] = [
  {
    id: "save_print",
    label: "Save & Print",
    description: "Save invoice and open print dialog",
    shortcut: "F9",
    category: "core",
    icon: Printer,
    iconColor: "text-blue-600",
    iconBg: "bg-blue-50",
  },
  {
    id: "save_new",
    label: "Save & New Bill",
    description: "Save invoice and start a fresh bill immediately",
    shortcut: "F8",
    category: "core",
    icon: FilePlus2,
    iconColor: "text-emerald-600",
    iconBg: "bg-emerald-50",
  },
  {
    id: "save_draft",
    label: "Save as Draft",
    description: "Park the bill for later without finalising",
    shortcut: "Ctrl+S",
    category: "core",
    icon: BookmarkCheck,
    iconColor: "text-amber-600",
    iconBg: "bg-amber-50",
  },
  {
    id: "whatsapp",
    label: "Save & WhatsApp",
    description: "Save and share invoice link via WhatsApp",
    category: "extended",
    icon: MessageCircle,
    iconColor: "text-green-600",
    iconBg: "bg-green-50",
  },
  {
    id: "email",
    label: "Save & Email",
    description: "Save and email invoice PDF to customer",
    category: "extended",
    icon: Mail,
    iconColor: "text-sky-600",
    iconBg: "bg-sky-50",
  },
  {
    id: "credit_sale",
    label: "Credit Sale",
    description: "Record as credit — customer settles later",
    category: "extended",
    icon: Clock3,
    iconColor: "text-violet-600",
    iconBg: "bg-violet-50",
  },
  {
    id: "delivery",
    label: "Delivery Order",
    description: "Save and schedule for home delivery",
    category: "extended",
    icon: Truck,
    iconColor: "text-orange-600",
    iconBg: "bg-orange-50",
  },
  {
    id: "pickup",
    label: "Pickup Order",
    description: "Save and mark for counter pickup",
    category: "extended",
    icon: Package,
    iconColor: "text-teal-600",
    iconBg: "bg-teal-50",
  },
  {
    id: "duplicate_print",
    label: "Duplicate Print",
    description: "Reprint the last saved invoice",
    category: "extended",
    icon: Copy,
    iconColor: "text-slate-600",
    iconBg: "bg-slate-100",
  },
  {
    id: "return",
    label: "Return / Refund",
    description: "Process a sales return or issue a refund",
    category: "extended",
    icon: RotateCcw,
    iconColor: "text-red-600",
    iconBg: "bg-red-50",
  },
];

export const ACTION_DEF_MAP = Object.fromEntries(
  ACTION_DEFS.map((d) => [d.id, d])
) as Record<ActionId, BillingActionDef>;

// ─── Preference shape ─────────────────────────────────────────────────────────

export type BillingActionPref = {
  id: ActionId;
  enabled: boolean;
  /** When true the action appears in the Save dropdown; otherwise only in More Actions panel */
  pinned: boolean;
  order: number;
};

export type BillingPreferences = {
  version: 1;
  actions: BillingActionPref[];
};

const STORAGE_KEY = "checkup_billing_prefs_v1";

const DEFAULT_PREFS: BillingPreferences = {
  version: 1,
  actions: [
    { id: "save_print",      enabled: true,  pinned: true,  order: 0 },
    { id: "save_new",        enabled: true,  pinned: true,  order: 1 },
    { id: "save_draft",      enabled: true,  pinned: true,  order: 2 },
    { id: "whatsapp",        enabled: true,  pinned: false, order: 3 },
    { id: "email",           enabled: false, pinned: false, order: 4 },
    { id: "credit_sale",     enabled: true,  pinned: false, order: 5 },
    { id: "delivery",        enabled: false, pinned: false, order: 6 },
    { id: "pickup",          enabled: false, pinned: false, order: 7 },
    { id: "duplicate_print", enabled: true,  pinned: false, order: 8 },
    { id: "return",          enabled: true,  pinned: false, order: 9 },
  ],
};

/**
 * Normalises a stored blob into a complete, valid preference set.
 *
 * Applied to whatever comes back from the API as well as to the cache, because the
 * database holds free-form JSON written by an older release: a config saved before
 * a new action existed must gain that action rather than silently hide it from the
 * bill screen.
 */
function normalise(raw: unknown): BillingPreferences {
  try {
    const parsed = raw as BillingPreferences | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.actions)) return DEFAULT_PREFS;
    const known = new Set(DEFAULT_PREFS.actions.map((a) => a.id));
    // Drop ids this build no longer knows about, then append any it has gained.
    const kept    = parsed.actions.filter((a) => known.has(a.id));
    const keptIds = new Set(kept.map((a) => a.id));
    const missing = DEFAULT_PREFS.actions.filter((a) => !keptIds.has(a.id));
    return { version: 1, actions: [...kept, ...missing] };
  } catch {
    return DEFAULT_PREFS;
  }
}

// ─── localStorage: a CACHE, never the source of truth ─────────────────────────
//
// The database is authoritative. This exists only so the bill screen can paint its
// action bar on the first frame instead of flashing defaults while a request is in
// flight — a till reopened mid-shift should not visibly rearrange its buttons.
//
// Consequences of that ordering, both deliberate:
//   · the cache is overwritten by whatever the server returns, even if it differs;
//   · it is only written AFTER a save the server accepted, so a rejected change is
//     never cached and cannot come back to life on the next load.

function readCache(): BillingPreferences | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalise(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeCache(prefs: BillingPreferences) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* quota — cache is optional */ }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useBillingPreferences() {
  // Seed from cache for an instant first paint; the server's copy replaces it below.
  const [prefs, setPrefsState] = useState<BillingPreferences>(() => readCache() ?? DEFAULT_PREFS);
  const [loading, setLoading]  = useState(true);
  const [saving,  setSaving]   = useState(false);
  const [error,   setError]    = useState<string | null>(null);
  // Whether the server's copy actually arrived. Writes are refused until it has —
  // otherwise a toggle made on top of a stale cache would PUT that cache over the
  // real config, quietly reverting whatever another till had saved.
  const [loaded,  setLoaded]   = useState(false);

  // Load from the database — the source of truth.
  useEffect(() => {
    let cancelled = false;
    api.get("/billing/preferences")
      .then(({ data }) => {
        if (cancelled) return;
        // A pharmacy that never configured anything reads back null; defaults apply
        // and are NOT written back, so "never set" stays distinguishable from "set".
        const next = data.data ? normalise(data.data) : DEFAULT_PREFS;
        setPrefsState(next);
        if (data.data) writeCache(next);
        setLoaded(true);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        // Keep showing the cached copy — a cashier mid-shift should not lose their
        // action bar over a failed request — but say so, and block writes below so a
        // stale cache can never be saved back over the server's real config.
        setError(getErrorMessage(err, "Could not load billing preferences."));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  /**
   * Applies a change locally, then persists it. The cache is only updated once the
   * server has accepted the write, so a rejected change never survives a reload.
   */
  const setPrefs = useCallback((updater: (prev: BillingPreferences) => BillingPreferences) => {
    if (!loaded) {
      setError("Still loading your saved preferences — please wait a moment and try again.");
      return;
    }
    setPrefsState((prev) => {
      const next = updater(prev);
      void persist(next);
      return next;
    });

    async function persist(next: BillingPreferences) {
      setSaving(true);
      try {
        await api.put("/billing/preferences", next);
        writeCache(next);
        setError(null);
      } catch (err) {
        setError(getErrorMessage(err, "Could not save billing preferences."));
      } finally {
        setSaving(false);
      }
    }
  }, [loaded]);

  const toggleEnabled = useCallback((id: ActionId) => {
    setPrefs((prev) => ({
      ...prev,
      actions: prev.actions.map((a) =>
        a.id === id
          ? { ...a, enabled: !a.enabled, pinned: a.enabled ? false : a.pinned }
          : a
      ),
    }));
  }, [setPrefs]);

  const togglePinned = useCallback((id: ActionId) => {
    setPrefs((prev) => ({
      ...prev,
      actions: prev.actions.map((a) => (a.id === id ? { ...a, pinned: !a.pinned } : a)),
    }));
  }, [setPrefs]);

  const moveAction = useCallback((id: ActionId, direction: "up" | "down") => {
    setPrefs((prev) => {
      const sorted = [...prev.actions].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((a) => a.id === id);
      const targetIdx = direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= sorted.length) return prev;
      const reordered = [...sorted];
      [reordered[idx], reordered[targetIdx]] = [reordered[targetIdx]!, reordered[idx]!];
      return { ...prev, actions: reordered.map((a, i) => ({ ...a, order: i })) };
    });
  }, [setPrefs]);

  const resetToDefaults = useCallback(() => {
    setPrefs(() => DEFAULT_PREFS);
  }, [setPrefs]);

  const sorted        = [...prefs.actions].sort((a, b) => a.order - b.order);
  const pinnedActions = sorted.filter((a) => a.enabled && a.pinned);
  const moreActions   = sorted.filter((a) => a.enabled && !a.pinned);

  return {
    prefs,
    sortedActions: sorted,
    pinnedActions,
    moreActions,
    toggleEnabled,
    togglePinned,
    moveAction,
    resetToDefaults,
    /** True until the server's copy has arrived (cached values are shown meanwhile). */
    loading,
    /** True while a change is being written to the database. */
    saving,
    /** Load or save failure, already made readable. Null when everything is fine. */
    error,
  };
}
