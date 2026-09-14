"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X, Loader2, PiggyBank, HandCoins, Undo2, BookUser, AlertCircle, FileX,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { AdvanceModal } from "./AdvanceModal";
import { CollectDuesModal } from "./CollectDuesModal";
import { cn } from "@/lib/utils";

// ─── Customer account (khata) ─────────────────────────────────────────────────
//
// One window for everything about a customer's money: what they owe, what we hold
// for them, every entry behind those two numbers, and the three things a counter
// ever does about it — take a deposit, collect dues, refund a deposit.
//
// It exists because the alternative is a tab switch. A cashier mid-bill who needs to
// take a deposit or see why a customer is over their limit would otherwise have to
// leave the bill, go to Customers or Dues, act, and come back — losing the cart's
// focus and their place. This opens over the bill (F6) and closes back onto it.
//
// Keyboard-first throughout: D / C / R fire the three actions, Esc closes. They are
// bound only while no child dialog is open, so a "d" typed into an amount field in
// the deposit dialog is just a rejected character, never a second dialog.

type Balances = {
  customerId: string;
  customerName: string;
  dues: number;
  advance: number;
  creditLimit: number;
  creditAvailable: number;
};

type LedgerEntry = {
  id: string;
  seq: number;
  type: string;
  entryNumber: string | null;
  amount: number;
  duesDelta: number;
  advanceDelta: number;
  duesBalanceAfter: number;
  advanceBalanceAfter: number;
  paymentMode: string | null;
  reference: string | null;
  notes: string | null;
  entryAt: string;
};

type Statement = {
  items: LedgerEntry[];
  total: number;
  page: number;
  totalPages: number;
  balances: Balances;
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What each ledger row is called at the counter, and which way the money went. */
const ENTRY_META: Record<string, { label: string; tone: string }> = {
  OPENING:         { label: "Opening balance",   tone: "text-slate-500"   },
  SALE:            { label: "Sold on account",   tone: "text-rose-600"    },
  PAYMENT:         { label: "Payment received",  tone: "text-emerald-600" },
  ADVANCE:         { label: "Deposit taken",     tone: "text-violet-600"  },
  ADVANCE_APPLIED: { label: "Deposit used",      tone: "text-violet-500"  },
  RETURN_CREDIT:   { label: "Goods returned",    tone: "text-amber-600"   },
  REFUND:          { label: "Deposit refunded",  tone: "text-amber-700"   },
  WRITE_OFF:       { label: "Written off",       tone: "text-slate-500"   },
};

export function CustomerAccountPanel({
  customer,
  onClose,
  onBalancesChanged,
}: {
  customer: { id: string; name: string };
  onClose: () => void;
  /** Lets the bill behind this panel pick up a deposit taken while it was open. */
  onBalancesChanged?: (balances: { dues: number; advance: number }) => void;
}) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [child, setChild] = useState<"deposit" | "refund" | "collect" | null>(null);

  const statement = useQuery({
    queryKey: ["customer-ledger", customer.id, page],
    queryFn: () =>
      api.get<{ data: Statement }>(`/customers/${customer.id}/ledger?page=${page}&limit=20`)
        .then((r) => r.data.data),
  });

  const b = statement.data?.balances;

  // Report upward whenever the server tells us the balances moved, so the bill behind
  // this panel does not keep offering a deposit that has just been spent or topped up.
  useEffect(() => {
    if (b) onBalancesChanged?.({ dues: b.dues, advance: b.advance });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b?.dues, b?.advance]);

  // Single-letter actions, live only while this panel owns the keyboard.
  useEffect(() => {
    if (child) return;
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === "escape") { e.preventDefault(); onClose(); return; }
      // Mirrors the buttons exactly, balances included — a shortcut that fires where
      // the button is greyed out is the same dead action, just harder to notice.
      if (!b) return;
      if (k === "d") { e.preventDefault(); setChild("deposit"); }
      else if (k === "c" && b.dues > 0) { e.preventDefault(); setChild("collect"); }
      else if (k === "r" && b.advance > 0) { e.preventDefault(); setChild("refund"); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [child, b, onClose]);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["customer-ledger", customer.id] });
  }

  return createPortal(
    <>
      <motion.div
        className="fixed inset-0 z-[230] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.15 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        >
          <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white flex-shrink-0">
            <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center flex-shrink-0">
              <BookUser className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Customer account</p>
              <p className="font-bold text-slate-900 text-[15px] truncate">
                {b?.customerName ?? customer.name}
              </p>
            </div>
            <button onClick={onClose} className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center flex-shrink-0 transition-colors">
              <X className="w-3.5 h-3.5 text-slate-500" />
            </button>
          </div>

          {/* Balances */}
          <div className="grid grid-cols-3 gap-3 px-5 py-4 flex-shrink-0">
            <Stat label="Outstanding" value={b ? inr(b.dues) : "—"} tone="rose" />
            <Stat label="On deposit"  value={b ? inr(b.advance) : "—"} tone="violet" />
            <Stat
              label="Credit left"
              value={b ? (b.creditLimit > 0 ? inr(b.creditAvailable) : "No credit") : "—"}
              tone="slate"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 px-5 pb-4 flex-shrink-0">
            {/* All three need the balances: each dialog opens against a figure it has
                to cap or charge against, so none can be offered before they arrive. */}
            <ActionBtn
              onClick={() => setChild("deposit")}
              icon={PiggyBank} label="Take deposit" hint="D"
              disabled={!b}
              className="bg-violet-600 hover:bg-violet-700"
            />
            <ActionBtn
              onClick={() => setChild("collect")}
              icon={HandCoins} label="Collect dues" hint="C"
              disabled={!b || b.dues <= 0}
              className="bg-emerald-600 hover:bg-emerald-700"
            />
            <ActionBtn
              onClick={() => setChild("refund")}
              icon={Undo2} label="Refund deposit" hint="R"
              disabled={!b || b.advance <= 0}
              className="bg-amber-600 hover:bg-amber-700"
            />
          </div>

          {/* Statement */}
          <div className="flex-1 min-h-0 overflow-auto border-t border-slate-100">
            {statement.isLoading ? (
              <div className="flex items-center justify-center py-16 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : statement.isError ? (
              <div className="py-16 text-center">
                <AlertCircle className="w-8 h-8 text-red-300 mx-auto mb-2" />
                <p className="text-[13px] text-red-500">Couldn't load this account's history.</p>
              </div>
            ) : (statement.data?.items.length ?? 0) === 0 ? (
              <div className="py-16 text-center">
                <FileX className="w-9 h-9 text-slate-200 mx-auto mb-2" />
                <p className="text-[13px] text-slate-500">
                  Nothing on this account yet — no credit sales, no deposits.
                </p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    {["Date", "Entry", "Amount", "Owes", "Held"].map((h, i) => (
                      <th key={h} className={cn(
                        "px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wide whitespace-nowrap",
                        i >= 2 ? "text-right" : "text-left",
                      )}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {statement.data?.items.map((e) => {
                    const meta = ENTRY_META[e.type] ?? { label: e.type, tone: "text-slate-600" };
                    return (
                      <tr key={e.id} className="border-t border-slate-50 hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 text-[12px] text-slate-500 whitespace-nowrap">
                          {new Date(e.entryAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}
                        </td>
                        <td className="px-4 py-2.5">
                          <p className={cn("text-[13px] font-semibold", meta.tone)}>{meta.label}</p>
                          <p className="text-[10px] text-slate-400 truncate max-w-[220px]">
                            {[e.entryNumber, e.paymentMode, e.notes].filter(Boolean).join(" · ") || "—"}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-right text-[13px] font-bold tabular-nums text-slate-700">
                          {inr(e.amount)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[12px] tabular-nums text-slate-500">
                          {inr(e.duesBalanceAfter)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[12px] tabular-nums text-slate-500">
                          {inr(e.advanceBalanceAfter)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {(statement.data?.totalPages ?? 1) > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 flex-shrink-0">
              <span className="text-[11px] text-slate-400">
                Page {statement.data?.page} of {statement.data?.totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1 rounded-lg text-[12px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                >Newer</button>
                <button
                  onClick={() => setPage((p) => Math.min(statement.data?.totalPages ?? 1, p + 1))}
                  disabled={page >= (statement.data?.totalPages ?? 1)}
                  className="px-3 py-1 rounded-lg text-[12px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                >Older</button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>

      {(child === "deposit" || child === "refund") && b && (
        <AdvanceModal
          target={{ id: customer.id, name: b.customerName, advanceBalance: b.advance }}
          mode={child === "refund" ? "refund" : "take"}
          onClose={() => setChild(null)}
          onSaved={refresh}
        />
      )}
      {child === "collect" && b && (
        <CollectDuesModal
          customer={{ id: customer.id, name: b.customerName, outstanding: b.dues }}
          onClose={() => setChild(null)}
          onSaved={refresh}
        />
      )}
    </>,
    document.body,
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "rose" | "violet" | "slate" }) {
  const tones = {
    rose:   "bg-rose-50 border-rose-200 text-rose-700",
    violet: "bg-violet-50 border-violet-200 text-violet-700",
    slate:  "bg-slate-50 border-slate-200 text-slate-700",
  }[tone];
  return (
    <div className={cn("rounded-xl border px-3 py-2.5", tones)}>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-[17px] font-bold tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

function ActionBtn({
  onClick, icon: Icon, label, hint, disabled, className,
}: {
  onClick: () => void; icon: React.ElementType; label: string; hint: string;
  disabled?: boolean; className: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-bold text-white transition-colors",
        "disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed",
        className,
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
      <kbd className="ml-0.5 px-1 rounded bg-white/20 text-[10px] font-mono">{hint}</kbd>
    </button>
  );
}
