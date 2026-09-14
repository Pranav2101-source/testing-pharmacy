"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { X, PiggyBank, Loader2, Banknote, Smartphone, CreditCard, Wallet } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import { useInvoicePrintConfig } from "@/lib/useInvoicePrintConfig";
import { openVoucherPrintWindow } from "@/lib/advanceVoucherPrint";
import { cn } from "@/lib/utils";

// Taking a deposit, and handing one back. Both move money across the counter against
// no bill, so both produce a numbered voucher the customer can be given.
//
// Refunds are a separate mode of this dialog rather than a separate screen: they are
// the same three fields and the same slip, and a cashier looking for "give the deposit
// back" looks where they took it.

const MODES = [
  { code: "CASH",   label: "Cash",   icon: Banknote,   takesReference: false },
  { code: "UPI",    label: "UPI",    icon: Smartphone, takesReference: true  },
  { code: "CARD",   label: "Card",   icon: CreditCard, takesReference: true  },
  { code: "WALLET", label: "Wallet", icon: Wallet,     takesReference: true  },
] as const;

type ModeCode = typeof MODES[number]["code"];

export type AdvanceTarget = {
  id: string;
  name: string;
  phone?: string | null;
  /** What is held for them right now — the ceiling on a refund. */
  advanceBalance: number;
};

type LedgerEntry = {
  entryNumber: string | null;
  amount: number;
  paymentMode: string | null;
  reference: string | null;
  notes: string | null;
  entryAt: string;
  advanceBalanceAfter: number;
  duesBalanceAfter: number;
};

export function AdvanceModal({
  target,
  mode,
  onClose,
  onSaved,
}: {
  target: AdvanceTarget;
  /** "take" collects a deposit; "refund" hands one back. */
  mode: "take" | "refund";
  onClose: () => void;
  onSaved?: (newAdvanceBalance: number) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { pharmacy } = useInvoicePrintConfig();

  const [amount, setAmount] = useState("");
  const [payMode, setPayMode] = useState<ModeCode>("CASH");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const isRefund = mode === "refund";
  const value = Number(amount) || 0;
  // A refund cannot exceed what is held. The server refuses it too, under the
  // customer's row lock — this only spares the cashier the round trip.
  const overBalance = isRefund && value > target.advanceBalance;
  const canSave = value > 0 && !overBalance && !saving;

  function setAmountGuarded(next: string) {
    // Digits and at most two decimals; a minus would turn a deposit into a refund.
    if (next !== "" && !/^\d*\.?\d{0,2}$/.test(next)) return;
    setAmount(next);
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const path = isRefund ? `/customers/${target.id}/refunds` : `/customers/${target.id}/advances`;
      const body = isRefund
        ? { amount: value, paymentMode: payMode, notes: notes.trim() || undefined }
        : {
            amount: value,
            paymentMode: payMode,
            reference: reference.trim() || undefined,
            notes: notes.trim() || undefined,
          };
      const { data } = await api.post(path, body);
      const entry = data.data.entry as LedgerEntry;
      const balances = data.data.balances as { advance: number };

      // Both screens that show a customer's money read from these.
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["dues"] });
      queryClient.invalidateQueries({ queryKey: ["customer-ledger", target.id] });

      // The money is recorded either way — only the slip depends on the pharmacy
      // profile having loaded. Saying so beats a button labelled "print" that
      // silently doesn't, which reads as the whole action having failed.
      if (!pharmacy) {
        toast.info("Recorded. Couldn't print the voucher — pharmacy details haven't loaded yet.");
      } else {
        openVoucherPrintWindow(
          {
            entryNumber: entry.entryNumber,
            kind: isRefund ? "REFUND" : "ADVANCE",
            amount: entry.amount,
            paymentMode: entry.paymentMode,
            reference: entry.reference,
            notes: entry.notes,
            entryAt: entry.entryAt,
            customerName: target.name,
            customerPhone: target.phone ?? null,
            advanceBalanceAfter: entry.advanceBalanceAfter,
            duesBalanceAfter: entry.duesBalanceAfter,
          },
          pharmacy,
        );
      }

      toast.success(isRefund
        ? `Refunded ₹${value.toFixed(2)} to ${target.name}`
        : `Took ₹${value.toFixed(2)} from ${target.name}`);
      onSaved?.(balances.advance);
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't record that — please try again."));
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
        }}
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 bg-gradient-to-br from-violet-50/70 to-white">
          <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center flex-shrink-0 shadow-sm shadow-violet-200">
            <PiggyBank className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-violet-500 uppercase tracking-wider">
              {isRefund ? "Refund advance" : "Take advance"}
            </p>
            <p className="font-bold text-slate-900 text-[15px] truncate">{target.name}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center flex-shrink-0 transition-colors">
            <X className="w-3.5 h-3.5 text-slate-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Currently held</span>
            <span className="text-[15px] font-bold tabular-nums text-slate-800">
              ₹{target.advanceBalance.toFixed(2)}
            </span>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              {isRefund ? "Amount to refund (₹)" : "Amount received (₹)"}
            </label>
            <input
              autoFocus
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmountGuarded(e.target.value)}
              placeholder="0.00"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[16px] font-bold text-right tabular-nums
                         focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400"
            />
            {overBalance && (
              <p className="text-[12px] text-rose-600 font-medium mt-1.5">
                Only ₹{target.advanceBalance.toFixed(2)} is held for {target.name} — that is the most that can be returned.
              </p>
            )}
            {/* The amounts a counter actually takes, so the common deposit is one key
                and no typing. A refund is almost always the whole balance. */}
            <div className="flex items-center gap-1.5 mt-2">
              {isRefund ? (
                <QuickAmount
                  label={`All · ₹${target.advanceBalance.toFixed(2)}`}
                  onClick={() => setAmount(String(target.advanceBalance))}
                />
              ) : (
                [500, 1000, 2000, 5000].map((n) => (
                  <QuickAmount key={n} label={`₹${n.toLocaleString("en-IN")}`} onClick={() => setAmount(String(n))} />
                ))
              )}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">
              {isRefund ? "Paid back by" : "Received by"}
            </label>
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
                        ? "bg-violet-50 border-violet-300 text-violet-700"
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

          {!isRefund && MODES.find((m) => m.code === payMode)?.takesReference && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Reference (optional)</label>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={payMode === "UPI" ? "UPI transaction id" : "Approval code"}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]
                           focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400"
              />
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Note (optional)</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={isRefund ? "Why is this being returned?" : "What is this deposit for?"}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]
                         focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400"
            />
          </div>
        </div>

        <div className="px-5 py-4 bg-slate-50 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400">
            <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 mx-0.5 rounded border border-slate-300 bg-white text-[10px] font-mono font-bold text-slate-500">↵</kbd>
            {isRefund ? " refund & print" : " take & print"}
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
            className="px-4 py-2 rounded-lg text-[13px] font-bold text-white bg-violet-600 hover:bg-violet-700
                       disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isRefund ? "Refund & print" : "Take & print"}
          </button>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function QuickAmount({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[11px] font-bold
                 text-slate-500 hover:border-violet-300 hover:text-violet-700 hover:bg-violet-50 transition-colors"
    >
      {label}
    </button>
  );
}
