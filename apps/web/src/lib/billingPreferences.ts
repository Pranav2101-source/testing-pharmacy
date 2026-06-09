import { useState, useCallback } from "react";
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

function loadPrefs(): BillingPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as BillingPreferences;
    if (parsed.version !== 1) return DEFAULT_PREFS;
    // Merge in any newly-added action IDs so old stored prefs stay valid
    const existingIds = new Set(parsed.actions.map((a) => a.id));
    const missing = DEFAULT_PREFS.actions.filter((a) => !existingIds.has(a.id));
    return { ...parsed, actions: [...parsed.actions, ...missing] };
  } catch {
    return DEFAULT_PREFS;
  }
}

function persistPrefs(prefs: BillingPreferences) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* quota */ }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useBillingPreferences() {
  const [prefs, setPrefsState] = useState<BillingPreferences>(loadPrefs);

  const setPrefs = useCallback((updater: (prev: BillingPreferences) => BillingPreferences) => {
    setPrefsState((prev) => {
      const next = updater(prev);
      persistPrefs(next);
      return next;
    });
  }, []);

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
    setPrefsState(DEFAULT_PREFS);
    persistPrefs(DEFAULT_PREFS);
  }, []);

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
  };
}
