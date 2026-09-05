"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Check, MessageSquare, Truck, Loader2,
  Tag, ReceiptText, Percent, IndianRupee,
} from "lucide-react";
import { useBillingStore } from "./useBillingStore";
import { computeNetPayable } from "@/lib/billTotals";
import { cn } from "@/lib/utils";

// ── Calculation engine ────────────────────────────────────────────────────────

export type BreakdownResult = {
  mrpTotal:         number;
  itemDiscountAmt:  number;
  billDiscountAmt:  number;
  totalDiscount:    number;
  billAmount:       number;  // after all discounts, before adjustments
  extraCharges:     number;
  adjustmentAmount: number;
  roundOff:         number;
  netPayable:       number;
  gst:              number;
  /** >0 when adjustments exceed the bill; the backend will refuse to save it. */
  shortfall:        number;
};

export function calcBreakdown(params: {
  items:            Array<{ mrp: number; quantity: number; amount: number; cgst: number; sgst: number }>;
  billDiscountPct:  number;
  extraCharges:     number;
  adjustmentAmount: number;
}): BreakdownResult {
  const { items, billDiscountPct, extraCharges, adjustmentAmount } = params;

  const mrpTotal        = items.reduce((s, i) => s + i.mrp * i.quantity, 0);
  const itemsTotal      = items.reduce((s, i) => s + i.amount, 0);
  const itemDiscountAmt = mrpTotal - itemsTotal;
  const billDiscountAmt = (billDiscountPct / 100) * itemsTotal;
  const totalDiscount   = itemDiscountAmt + billDiscountAmt;
  const billAmount      = itemsTotal - billDiscountAmt;
  const gst             = items.reduce((s, i) => s + i.cgst + i.sgst, 0);

  // Shared with BillingNewPage so the breakdown and the header total can never
  // disagree, and deliberately NOT clamped to zero — see lib/billTotals.ts.
  // billAmount, not itemsTotal: this modal derives its figures from the rounded cart
  // LINE amounts, which are shown before the bill discount so the deduction can appear
  // as its own row. computeNetPayable no longer subtracts the discount itself — it now
  // reduces the taxable value upstream — so the already-discounted figure goes in.
  const { roundOff, netPayable, shortfall } = computeNetPayable({
    itemsTotal: billAmount, extraCharges, adjustmentAmount,
  });

  return {
    mrpTotal, itemDiscountAmt, billDiscountAmt, totalDiscount,
    billAmount, extraCharges, adjustmentAmount, roundOff, netPayable, gst, shortfall,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, showSign = false): string {
  const abs = Math.abs(n).toFixed(2);
  if (showSign && n < 0) return `-₹${abs}`;
  if (showSign && n > 0) return `+₹${abs}`;
  return `₹${abs}`;
}

function InlineInput({
  value, onChange, prefix, min, allowNegative, placeholder,
}: {
  value:         number;
  onChange:      (v: number) => void;
  prefix?:       string;
  min?:          number;
  allowNegative?: boolean;
  placeholder?:  string;
}) {
  const [raw, setRaw] = useState(String(value === 0 ? "" : value));

  useEffect(() => { setRaw(value === 0 ? "" : String(value)); }, [value]);

  function commit(s: string) {
    const n = parseFloat(s);
    if (isNaN(n)) { onChange(0); return; }
    const clamped = min !== undefined && !allowNegative ? Math.max(min, n) : n;
    onChange(parseFloat(clamped.toFixed(2)));
  }

  return (
    <div className="flex items-center gap-1 justify-end">
      {prefix && <span className="text-[13px] text-slate-400">{prefix}</span>}
      <input
        type="number"
        value={raw}
        placeholder={placeholder ?? "0"}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }}
        className="w-20 text-right text-[14px] font-semibold text-slate-800 border-b border-slate-300 focus:border-blue-500 focus:outline-none bg-transparent py-0.5 tabular-nums"
      />
    </div>
  );
}

// ── Summary row ───────────────────────────────────────────────────────────────

function SummaryRow({
  label, value, valueClass, dimmed, separator,
}: {
  label:       string;
  value:       React.ReactNode;
  valueClass?: string;
  dimmed?:     boolean;
  separator?:  boolean;
}) {
  return (
    <>
      {separator && <div className="my-3 border-t border-slate-100" />}
      <div className={cn("flex items-center justify-between py-1.5", dimmed && "opacity-50")}>
        <span className="text-[13px] text-slate-500">{label}</span>
        <span className={cn("text-[14px] font-semibold tabular-nums", valueClass ?? "text-slate-800")}>
          {value}
        </span>
      </div>
    </>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function InvoiceBreakdownModal({
  onClose,
  onSubmit,
  submitting,
}: {
  onClose:    () => void;
  onSubmit:   () => void | Promise<void>;
  submitting: boolean;
}) {
  // Granular store selectors
  const items                  = useBillingStore((s) => s.items);
  const notes                  = useBillingStore((s) => s.meta.notes);
  const deliveryNotes          = useBillingStore((s) => s.meta.deliveryNotes);
  const billDiscountPct        = useBillingStore((s) => s.meta.billDiscountPct);
  const extraCharges           = useBillingStore((s) => s.meta.extraCharges);
  const adjustmentAmount       = useBillingStore((s) => s.meta.adjustmentAmount);
  const customerName            = useBillingStore((s) => s.meta.customerName);
  const customerDefaultDiscount = useBillingStore((s) => s.meta.customerDefaultDiscount);
  const isInterstate            = useBillingStore((s) => s.meta.isInterstate);
  const setMeta                 = useBillingStore((s) => s.setMeta);

  // True when the current bill discount matches what the customer profile specifies
  const isCustomerDiscount = customerDefaultDiscount > 0 && billDiscountPct === customerDefaultDiscount;

  // Local UI state
  const [notesTab,      setNotesTab]      = useState<"internal" | "delivery">("internal");
  // Initialise with current billDiscountPct so customer default discount shows in the input on open
  const [discPctInput,  setDiscPctInput]  = useState(billDiscountPct > 0 ? String(billDiscountPct) : "");
  const [discAmtInput,  setDiscAmtInput]  = useState("");
  const [discError,     setDiscError]     = useState("");
  const [discApplied,   setDiscApplied]   = useState(false);

  // Derived breakdown — recomputes reactively with store
  const bd = useMemo(
    () => calcBreakdown({ items, billDiscountPct, extraCharges, adjustmentAmount }),
    [items, billDiscountPct, extraCharges, adjustmentAmount],
  );

  // Items total before bill discount — must be declared before callbacks that use it
  const itemsTotal = bd.mrpTotal - bd.itemDiscountAmt;

  // Flash "applied" confirmation
  useEffect(() => {
    if (!discApplied) return;
    const t = setTimeout(() => setDiscApplied(false), 1500);
    return () => clearTimeout(t);
  }, [discApplied]);

  // ESC to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Apply discount by %
  const applyDiscountPct = useCallback(() => {
    const val = parseFloat(discPctInput);
    if (isNaN(val) || val < 0 || val > 100) { setDiscError("Enter 0 – 100"); return; }
    setDiscError("");
    setMeta({ billDiscountPct: val });
    setDiscAmtInput(((val / 100) * itemsTotal).toFixed(2));
    setDiscApplied(true);
  }, [discPctInput, itemsTotal, setMeta]);

  // Apply discount by ₹ amount (converts to %)
  const applyDiscountAmt = useCallback(() => {
    if (itemsTotal === 0) return;
    const amt = parseFloat(discAmtInput);
    if (isNaN(amt) || amt < 0) { setDiscError("Enter a valid amount"); return; }
    if (amt > itemsTotal) { setDiscError("Amount exceeds bill total"); return; }
    const pct = (amt / itemsTotal) * 100;
    setDiscError("");
    setMeta({ billDiscountPct: parseFloat(pct.toFixed(6)) });
    setDiscPctInput(pct.toFixed(2));
    setDiscApplied(true);
  }, [discAmtInput, itemsTotal, setMeta]);

  const internalNoteLen = notes.length;
  const deliveryNoteLen = deliveryNotes.length;
  const NOTE_MAX = 150;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        exit={{   opacity: 0, scale: 0.97, y: 8  }}
        transition={{ type: "spring", stiffness: 360, damping: 30 }}
        className="bg-white rounded-2xl shadow-2xl w-full flex flex-col overflow-hidden"
        style={{ maxWidth: 960, maxHeight: "92vh" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* ── Sticky header ─────────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ background: "linear-gradient(135deg,#3b0764 0%,#4c1d7c 50%,#5b21a8 100%)" }}
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/15 ring-1 ring-white/25 flex items-center justify-center">
              <ReceiptText className="w-4 h-4 text-white" strokeWidth={1.8} />
            </div>
            <div>
              <h2 className="text-white font-bold text-[16px] leading-tight">Invoice Breakdown</h2>
              <p className="text-blue-200/70 text-[11px] mt-0.5">
                {items.length} item{items.length !== 1 ? "s" : ""} · Review and adjust before saving
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onSubmit}
              disabled={submitting || items.length === 0}
              className="flex items-center gap-1.5 bg-white text-purple-700 font-bold text-[13px] px-5 py-2 rounded-lg hover:bg-purple-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {submitting ? "Saving…" : "Submit"}
            </button>
            <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Body ──────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] divide-y md:divide-y-0 md:divide-x divide-slate-100">

            {/* ── LEFT COLUMN ─────────────────────────────────────────────── */}
            <div className="p-5 space-y-4">

              {/* Bill Discount card */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  <Tag className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-[12px] font-bold text-slate-700 uppercase tracking-wide">Bill Discount</span>
                  {billDiscountPct > 0 && (
                    <span className="ml-auto text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                      {billDiscountPct.toFixed(1)}% active
                    </span>
                  )}
                  {isCustomerDiscount && customerName && customerName !== "Counter" && (
                    <span className="text-[10px] text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full font-semibold flex-shrink-0">
                      from {customerName}
                    </span>
                  )}
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    {/* % input */}
                    <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-3 py-2 flex-1 focus-within:border-blue-400 transition-colors">
                      <input
                        type="number"
                        value={discPctInput}
                        onChange={(e) => { setDiscPctInput(e.target.value); setDiscError(""); }}
                        onKeyDown={(e) => { if (e.key === "Enter") applyDiscountPct(); }}
                        placeholder="0"
                        min={0} max={100} step={0.5}
                        className="w-full text-[14px] font-semibold text-slate-800 bg-transparent focus:outline-none tabular-nums placeholder-slate-300"
                      />
                      <Percent className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                    </div>

                    <span className="text-[11px] font-bold text-slate-400 flex-shrink-0">OR</span>

                    {/* ₹ input */}
                    <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-3 py-2 flex-1 focus-within:border-blue-400 transition-colors">
                      <IndianRupee className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <input
                        type="number"
                        value={discAmtInput}
                        onChange={(e) => { setDiscAmtInput(e.target.value); setDiscError(""); }}
                        onKeyDown={(e) => { if (e.key === "Enter") applyDiscountAmt(); }}
                        placeholder="0.00"
                        min={0}
                        className="w-full text-[14px] font-semibold text-slate-800 bg-transparent focus:outline-none tabular-nums placeholder-slate-300"
                      />
                    </div>

                    {/* Apply button */}
                    <button
                      onClick={() => {
                        if (discAmtInput) applyDiscountAmt();
                        else applyDiscountPct();
                      }}
                      className={cn(
                        "flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0 transition-all",
                        discApplied
                          ? "bg-emerald-500 text-white scale-95"
                          : "bg-blue-600 hover:bg-blue-700 text-white",
                      )}
                    >
                      <Check className="w-4 h-4" strokeWidth={2.5} />
                    </button>
                  </div>

                  <AnimatePresence>
                    {discError && (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="text-[12px] text-red-600 font-medium overflow-hidden"
                      >
                        {discError}
                      </motion.p>
                    )}
                  </AnimatePresence>

                  <p className="text-[11px] text-blue-600 font-medium">
                    Bill discount applies to items with Min Disc 0% and Max Disc 100%.
                  </p>

                  {billDiscountPct > 0 && (
                    <div className="flex items-center justify-between text-[12px] bg-emerald-50 rounded-lg px-3 py-2">
                      <span className="text-emerald-700">Discount amount</span>
                      <span className="font-bold text-emerald-800">-{fmt(bd.billDiscountAmt)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Notes card */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="flex border-b border-slate-200">
                  {(["internal", "delivery"] as const).map((tab) => {
                    const isActive = notesTab === tab;
                    const Icon = tab === "internal" ? MessageSquare : Truck;
                    const count = tab === "internal" ? internalNoteLen : deliveryNoteLen;
                    return (
                      <button
                        key={tab}
                        onClick={() => setNotesTab(tab)}
                        className={cn(
                          "flex items-center gap-1.5 flex-1 px-3 py-2.5 text-[12px] font-semibold transition-colors",
                          isActive
                            ? "text-blue-700 border-b-2 border-blue-600 bg-blue-50/50"
                            : "text-slate-500 hover:text-slate-700 hover:bg-slate-50",
                        )}
                      >
                        <Icon className="w-3 h-3" />
                        {tab === "internal" ? "Internal Notes" : "Delivery Notes"}
                        {count > 0 && (
                          <span className="ml-auto text-[10px] bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5 font-bold leading-none">
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="p-3">
                  <div className="bg-amber-50 border border-amber-200/60 rounded-lg overflow-hidden">
                    <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
                      <MessageSquare className="w-3 h-3 text-amber-500" />
                      <span className="text-[10px] text-amber-600 font-semibold">
                        ({notesTab === "internal" ? internalNoteLen : deliveryNoteLen}/{NOTE_MAX})
                      </span>
                    </div>
                    <textarea
                      key={notesTab}
                      value={notesTab === "internal" ? notes : deliveryNotes}
                      onChange={(e) => {
                        const v = e.target.value.slice(0, NOTE_MAX);
                        setMeta(notesTab === "internal" ? { notes: v } : { deliveryNotes: v });
                      }}
                      rows={4}
                      placeholder="type note ..."
                      className="w-full bg-transparent px-3 pb-2.5 text-[13px] text-slate-700 placeholder-amber-300 focus:outline-none resize-none"
                    />
                  </div>
                </div>
              </div>

              {/* Tax Summary card */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="grid grid-cols-3 divide-x divide-slate-200">
                  {[
                    { label: isInterstate ? "IGST" : "CGST+SGST", value: fmt(bd.gst), color: "text-slate-800", placeholder: false },
                    // Neither is computed anywhere in this cart (no cess field on a line;
                    // margin needs purchaseRate, which cart items don't carry) — showing a
                    // hardcoded ₹0 / 0.00% here used to look like real, live figures.
                    { label: "CESS",   value: "Not available", color: "text-slate-400", placeholder: true },
                    { label: "Margin", value: "Not available", color: "text-slate-400", placeholder: true },
                  ].map(({ label, value, color, placeholder }) => (
                    <div key={label} className="flex flex-col items-center py-3 px-2">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">{label}</span>
                      <span className={cn(placeholder ? "text-[11px] font-semibold italic" : "text-[14px] font-bold tabular-nums", color)}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── RIGHT COLUMN ────────────────────────────────────────────── */}
            <div className="p-6 flex flex-col">
              <div className="flex-1 space-y-0.5">

                <SummaryRow
                  label="MRP Total"
                  value={fmt(bd.mrpTotal)}
                />
                <SummaryRow
                  label="Item Discount"
                  value={bd.itemDiscountAmt > 0 ? `-${fmt(bd.itemDiscountAmt)}` : fmt(0)}
                  valueClass={bd.itemDiscountAmt > 0 ? "text-rose-600" : "text-slate-400"}
                />
                {bd.billDiscountAmt > 0 && (
                  <SummaryRow
                    label={`Bill Discount (${billDiscountPct.toFixed(1)}%)`}
                    value={`-${fmt(bd.billDiscountAmt)}`}
                    valueClass="text-rose-600"
                  />
                )}

                <SummaryRow
                  label="Bill Amount"
                  value={fmt(bd.billAmount)}
                  valueClass="text-slate-900 font-bold"
                  separator
                />

                {/* Extra charges — editable */}
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-[13px] text-slate-500">Extra Charges</span>
                  <InlineInput
                    value={extraCharges}
                    onChange={(v) => setMeta({ extraCharges: v })}
                    prefix="₹"
                    min={0}
                    placeholder="0"
                  />
                </div>

                {/* Adjustment — editable, negative allowed but clamped so total ≥ 0 */}
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-[13px] text-slate-500">Adjustment Amount</span>
                  <InlineInput
                    value={adjustmentAmount}
                    onChange={(v) => {
                      // Prevent adjustment that would push total below zero
                      const floor = -(bd.billAmount + bd.extraCharges);
                      setMeta({ adjustmentAmount: Math.max(floor, v) });
                    }}
                    allowNegative
                    placeholder="0"
                  />
                </div>

                <SummaryRow
                  label="Round Off"
                  value={bd.roundOff === 0 ? "0.00" : fmt(bd.roundOff, true)}
                  valueClass={bd.roundOff !== 0 ? "text-slate-600" : "text-slate-400"}
                />
              </div>

              {/* Net Payable — prominent section */}
              <div className="mt-6 pt-4 border-t-2 border-slate-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Net Payable Amount</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Inclusive of all taxes</p>
                  </div>
                  <motion.div
                    key={Math.round(bd.netPayable)}
                    initial={{ scale: 0.92, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 420, damping: 26 }}
                  >
                    <span className="text-[36px] font-black text-purple-700 tabular-nums leading-none">
                      {Math.round(bd.netPayable)}
                    </span>
                    <span className="text-[18px] font-bold text-purple-400 ml-1">₹</span>
                  </motion.div>
                </div>

                {(bd.totalDiscount > 0) && (
                  <div className="mt-3 flex items-center gap-2 bg-emerald-50 border border-emerald-200/60 rounded-lg px-4 py-2">
                    <Tag className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                    <span className="text-[12px] text-emerald-700 font-medium">
                      Total savings on this bill
                    </span>
                    <span className="ml-auto text-[13px] font-bold text-emerald-700">
                      -{fmt(bd.totalDiscount)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
