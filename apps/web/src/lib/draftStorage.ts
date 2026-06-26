import type { CartItem, BillingMeta } from "@/components/billing/useBillingStore";

const KEY = "checkup_billing_drafts";

export type DraftBill = {
  id: string;
  label: string;
  savedAt: string;
  items: CartItem[];
  meta: BillingMeta;
};

function readAll(): DraftBill[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(drafts: DraftBill[]) {
  localStorage.setItem(KEY, JSON.stringify(drafts));
}

export function saveDraft(items: CartItem[], meta: BillingMeta): DraftBill {
  const drafts = readAll();
  const hasNamedCustomer = meta.customerName.trim() && meta.customerId !== "COUNTER";
  const label = hasNamedCustomer
    ? `${meta.customerName} — ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
    : `Draft — ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}`;

  const draft: DraftBill = {
    id: crypto.randomUUID(),
    label,
    savedAt: new Date().toISOString(),
    items,
    meta,
  };
  writeAll([draft, ...drafts]);
  return draft;
}

export function listDrafts(): DraftBill[] {
  return readAll();
}

export function getDraft(id: string): DraftBill | null {
  return readAll().find((d) => d.id === id) ?? null;
}

export function deleteDraft(id: string) {
  writeAll(readAll().filter((d) => d.id !== id));
}

export function clearAllDrafts() {
  writeAll([]);
}
