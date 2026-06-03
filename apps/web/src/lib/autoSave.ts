import type { CartItem, BillingMeta } from "@/components/billing/useBillingStore";

const KEY    = "checkup_billing_session";
const MAX_MS = 2 * 60 * 60 * 1000; // discard sessions older than 2 hours

export type AutoSaveSession = {
  items:   CartItem[];
  meta:    BillingMeta;
  savedAt: string;
};

export function saveSession(items: CartItem[], meta: BillingMeta): void {
  if (typeof window === "undefined" || items.length === 0) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ items, meta, savedAt: new Date().toISOString() }));
  } catch {
    // Storage quota exceeded — silently swallow; data loss is preferable to crashing
  }
}

export function loadSession(): AutoSaveSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AutoSaveSession;
    if (!Array.isArray(s.items) || s.items.length === 0) return null;
    if (Date.now() - new Date(s.savedAt).getTime() > MAX_MS) {
      clearSession();
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
