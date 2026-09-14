"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, HandCoins, Loader2, Banknote, Smartphone, CreditCard, Wallet, FileX } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

// Recording a customer paying down their khata.
//
// The backend for this (`POST /billing/{id}/payments`) has existed and been correct
// for two releases — it posts the ledger entry, decrements what the customer owes by
// exactly the amount collected, and refuses a backdated date. It simply had no caller:
// dues could be run up from the till but only settled by hand against the API.
//
// Payment is per BILL, not per customer, because that is what the ledger records
// against — so the cashier picks which bill the money is for. Oldest first, since that
// is the one a customer settling up means.

const MODES = [
  { code: "CASH",   label: "Cash",   icon: Banknote   },
  { code: "UPI",    label: "UPI",    icon: Smartphone },
  { code: "CARD",   label: "Card",   icon: CreditCard },
  { code: "WALLET", label: "Wallet", icon: Wallet     },
] as const;

type ModeCode = typeof MODES[number]["code"];

type UnpaidBill = {
  id: string;
  invoiceNumber: string;
  createdAt: string;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: string;
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function CollectDuesModal({
  customer,
  onClose,
  onSaved,
}: {
  customer: { id: string; name: string; outstanding: number };
  onClose: () => void;
  /** Lets an account panel hosting this dialog re-read the khata it just changed. */
  onSaved?: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [payMode, setPayMode] = useState<ModeCode>("CASH");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);

  // PENDING and PARTIAL are two separate server-side filters, so both are fetched and
  // merged here rather than asking for "not paid", which the endpoint cannot express.
  const bills = useQuery({
    queryKey: ["dues", "unpaid-bills", customer.id],
    queryFn: async () => {
      const [pending, partial] = await Promise.all([
        api.get(`/billing?customerId=${customer.id}&paymentStatus=PENDING&limit=100`),
        api.get(`/billing?customerId=${customer.id}&paymentStatus=PARTIAL&limit=100`),
      ]);
      const rows: UnpaidBill[] = [...pending.data.data.items, ...partial.data.data.items];
      return rows
        .filter((b) => b.balanceDue > 0)
        // Oldest first — the bill a customer settling their account means.
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
  });

  const selected = bills.data?.find((b) => b.id === selectedId) ?? null;
  const value = Number(amount) || 0;
  const overBill = selected != null && value > selected.balanceDue;
  const canSave = selected != null && value > 0 && !overBill && !saving;

  function pick(bill: UnpaidBill) {
    setSelectedId(bill.id);
    // Settling a bill in full is the common case; pre-filling it saves the keystrokes
    // and still leaves the figure editable for a part payment.
    setAmount(String(bill.balanceDue));
  }

  // The oldest unpaid bill, already selected. A customer settling up almost always
  // means that one, so the common case is open-the-dialog-and-press-Enter — no
  // clicking, no typing. Only runs once the list arrives, and never overrides a
  // choice already made.
  useEffect(() => {
    if (selectedId != null) return;
    const first = bills.data?.[0];
    if (first) pick(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills.data]);

  /** ↑/↓ moves between bills without leaving the amount field. */
  function step(delta: number) {
    const list = bills.data ?? [];
    if (list.length === 0) return;
    const at = list.findIndex((b) => b.id === selectedId);
    const next = list[Math.min(list.length - 1, Math.max(0, (at < 0 ? 0 : at) + delta))];
    if (next) pick(next);
  }

  function setAmountGuarded(next: string) {
    if (next !== "" && !/^\d*\.?\d{0,2}$/.test(next)) return;
    setAmount(next);
  }

  async function save() {
    if (!canSave || selected == null) return;
    setSaving(true);
    try {
      await api.post(`/billing/${selected.id}/payments`, {
        amount: value,
        paymentMode: payMode,
        reference: reference.trim() || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["dues"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["billing"] });
      queryClient.invalidateQueries({ queryKey: ["customer-ledger", customer.id] });
      toast.success(`Collected ${inr(value)} from ${customer.name}`);
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't record that payment — please try again."));
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[240] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); onClose(); }
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void save(); }
          if (e.key === "ArrowDown") { e.preventDefault(); step(1); }
          if (e.key === "ArrowUp")   { e.preventDefault(); step(-1); }
        }}
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 bg-gradient-to-br from-emerald-50/70 to-white">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center flex-shrink-0 shadow-sm shadow-emerald-200">
            <HandCoins className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Collect dues</p>
            <p className="font-bold text-slate-900 text-[15px] truncate">
              {customer.name} — {inr(customer.outstanding)} outstanding
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center flex-shrink-0 transition-colors">
            <X className="w-3.5 h-3.5 text-slate-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">Which bill?</label>
            {bills.isLoading ? (
              <div className="flex items-center justify-center py-8 text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : bills.isError ? (
              <p className="text-[13px] text-rose-600 py-4">Couldn't load this customer's bills.</p>
            ) : (bills.data?.length ?? 0) === 0 ? (
              <div className="py-8 text-center">
                <FileX className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-[13px] text-slate-500">
                  No unpaid bills — anything owed here predates the ledger.
                </p>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-56 overflow-auto">
                {bills.data?.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => pick(b)}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors",
                      selectedId === b.id ? "bg-emerald-50" : "hover:bg-slate-50",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-slate-800 truncate">{b.invoiceNumber}</p>
                      <p className="text-[11px] text-slate-400">
                        {new Date(b.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                        {b.amountPaid > 0 && ` · ${inr(b.amountPaid)} paid`}
                      </p>
                    </div>
                    <span className="text-[13px] font-bold text-emerald-600 tabular-nums flex-shrink-0 ml-3">
                      {inr(b.balanceDue)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selected && (
            <>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Amount collected (₹)</label>
                <input
                  autoFocus
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmountGuarded(e.target.value)}
                  placeholder="0.00"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[16px] font-bold text-right tabular-nums
                             focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
                />
                {overBill && (
                  <p className="text-[12px] text-rose-600 font-medium mt-1.5">
                    {selected.invoiceNumber} only has {inr(selected.balanceDue)} outstanding — collect the rest against another bill.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">Received by</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {MODES.map((m) => {
                    const Icon = m.icon;
                    const active = payMode === m.code;
                    return (
                      <button
                        key={m.code}
                        type="button"
                        onClick={() => setPayMode(m.code)}
                        className={cn(
                          "flex flex-col items-center gap-1 py-2 rounded-lg text-[11px] font-bold border transition-colors",
                          active
                            ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                            : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50",
                        )}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {payMode !== "CASH" && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Reference (optional)</label>
                  <input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder={payMode === "UPI" ? "UPI transaction id" : "Approval code"}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]
                               focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-4 bg-slate-50 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400">
            <Kbd>↑</Kbd><Kbd>↓</Kbd> bill · <Kbd>↵</Kbd> record · <Kbd>Esc</Kbd> close
          </p>
          <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] font-semibold text-slate-600 hover:bg-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!canSave}
            className="px-4 py-2 rounded-lg text-[13px] font-bold text-white bg-emerald-600 hover:bg-emerald-700
                       disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Record payment
          </button>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 mx-0.5 rounded border border-slate-300 bg-white text-[10px] font-mono font-bold text-slate-500">
      {children}
    </kbd>
  );
}
