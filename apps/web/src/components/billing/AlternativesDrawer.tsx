"use client";

import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  X, ArrowLeftRight, Plus, Package, Loader2, AlertCircle,
  Sparkles, TrendingUp, Pill,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useBillingStore } from "./useBillingStore";
import { cn } from "@/lib/utils";
import type { MedicineSearchResult, AlternativeResult, AlternativeBatch } from "@pharmacy/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STOCK_ORDER: Record<AlternativeResult["stockStatus"], number> = {
  in_stock:     0,
  low_stock:    1,
  out_of_stock: 2,
};

function sortAlternatives(alts: AlternativeResult[]): AlternativeResult[] {
  return [...alts].sort((a, b) => {
    const s = STOCK_ORDER[a.stockStatus] - STOCK_ORDER[b.stockStatus];
    if (s !== 0) return s;
    if (b.totalStock !== a.totalStock) return b.totalStock - a.totalStock;
    const mA = a.margin ?? -Infinity;
    const mB = b.margin ?? -Infinity;
    if (mB !== mA) return mB - mA;
    return a.mrp - b.mrp;
  });
}

function fmtExpiry(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

// ── Stock indicators ──────────────────────────────────────────────────────────

function StockDot({ status }: { status: AlternativeResult["stockStatus"] }) {
  return (
    <span className={cn(
      "w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1",
      status === "in_stock"     ? "bg-emerald-500" :
      status === "low_stock"    ? "bg-amber-400"   : "bg-red-400"
    )} />
  );
}

function StockBadge({ status, qty }: { status: AlternativeResult["stockStatus"]; qty: number }) {
  if (status === "in_stock")
    return <span className="text-xs font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full">{qty} in stock</span>;
  if (status === "low_stock")
    return <span className="text-xs font-bold text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full">Low: {qty}</span>;
  return <span className="text-xs font-bold text-red-700 bg-red-100 border border-red-300 px-2 py-0.5 rounded-full">Out of stock</span>;
}

// ── Alternative card ──────────────────────────────────────────────────────────

function AlternativeCard({
  alt,
  isHighlighted,
  onAdd,
  onReplace,
  onHover,
}: {
  alt:           AlternativeResult;
  isHighlighted: boolean;
  onAdd:         (batch: AlternativeBatch) => void;
  onReplace:     ((batch: AlternativeBatch) => void) | null;
  onHover:       () => void;
}) {
  const [expandBatches, setExpandBatches] = useState(false);
  const [pendingAction, setPendingAction] = useState<"add" | "replace" | null>(null);

  const now          = new Date();
  const validBatches = alt.batches.filter(
    (b) => new Date(b.expiryDate) > now && (b.quantity - b.reservedQuantity) > 0,
  );
  const isOutOfStock = alt.stockStatus === "out_of_stock";

  const dispatch = useCallback((action: "add" | "replace") => {
    if (validBatches.length === 0) return;
    if (validBatches.length === 1) {
      if (action === "add") onAdd(validBatches[0]!);
      else onReplace?.(validBatches[0]!);
      setExpandBatches(false);
    } else {
      setPendingAction(action);
      setExpandBatches((v) => !v);
    }
  }, [validBatches, onAdd, onReplace]);

  const pickBatch = useCallback((batch: AlternativeBatch) => {
    if (pendingAction === "add") onAdd(batch);
    else onReplace?.(batch);
    setExpandBatches(false);
    setPendingAction(null);
  }, [pendingAction, onAdd, onReplace]);

  return (
    <div
      onMouseEnter={onHover}
      className={cn(
        "rounded-xl border overflow-hidden transition-all duration-150",
        isHighlighted
          ? "border-blue-400 bg-blue-50 ring-2 ring-blue-300/50 shadow-md"
          : "border-slate-300 bg-white hover:border-slate-400 hover:shadow-sm",
        isOutOfStock && "opacity-70",
      )}
    >
      <div className="px-4 py-3.5">
        {/* Row 1: stock dot + name + margin badge */}
        <div className="flex items-start gap-2.5">
          <StockDot status={alt.stockStatus} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900 leading-tight">{alt.name}</p>
            {alt.manufacturer && (
              <p className="text-xs text-slate-600 mt-0.5 truncate">{alt.manufacturer}</p>
            )}
          </div>
          {alt.margin !== null && alt.margin > 0 && (
            <div className="flex items-center gap-1 flex-shrink-0 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full">
              <TrendingUp className="w-3 h-3 text-emerald-700" />
              <span className="text-xs font-bold text-emerald-800">{alt.margin.toFixed(1)}%</span>
            </div>
          )}
        </div>

        {/* Row 2: chips + stock badge */}
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {alt.packSize && (
            <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-md font-semibold">{alt.packSize}</span>
          )}
          {alt.strength && (
            <span className="text-xs bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-md font-semibold">{alt.strength}</span>
          )}
          {alt.form && (
            <span className="text-xs bg-violet-100 text-violet-700 border border-violet-200 px-2 py-0.5 rounded-md font-semibold capitalize">{alt.form}</span>
          )}
          <div className="flex-1" />
          <StockBadge status={alt.stockStatus} qty={alt.totalStock} />
        </div>

        {/* Row 3: price + brand + actions */}
        <div className="flex items-center justify-between gap-2 mt-3">
          <div className="flex items-baseline gap-1.5">
            <span className="text-base font-extrabold text-slate-800 tabular-nums">
              {alt.mrp > 0 ? `₹${alt.mrp.toFixed(2)}` : "—"}
            </span>
            {alt.brand && (
              <span className="text-xs text-slate-500 truncate max-w-[100px]">{alt.brand.name}</span>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {onReplace && !isOutOfStock && (
              <button
                onClick={() => dispatch("replace")}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 transition-colors"
                title="Swap current cart item with this alternative"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                Replace
              </button>
            )}
            <button
              onClick={() => dispatch("add")}
              disabled={isOutOfStock}
              className={cn(
                "flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors active:scale-[0.97]",
                isOutOfStock
                  ? "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              )}
            >
              <Plus className="w-3.5 h-3.5" />
              Add to Bill
            </button>
          </div>
        </div>
      </div>

      {/* Inline batch picker */}
      <AnimatePresence>
        {expandBatches && validBatches.length > 1 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="overflow-hidden"
          >
            <div className="border-t border-slate-200 bg-slate-50 p-2 space-y-1">
              <div className="flex items-center justify-between px-2 py-1">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                  Select a batch
                </p>
                <button
                  onClick={() => setExpandBatches(false)}
                  className="w-5 h-5 text-slate-400 hover:text-slate-600 flex items-center justify-center"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {validBatches.map((b) => (
                <button
                  key={b.id}
                  onClick={() => pickBatch(b)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-white hover:bg-blue-50 rounded-lg text-left transition-colors border border-slate-200 hover:border-blue-200"
                >
                  <div>
                    <span className="text-sm font-semibold text-slate-800">Batch {b.batchNumber}</span>
                    <span className="ml-2 text-xs text-slate-500">Exp: {fmtExpiry(b.expiryDate)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="font-bold text-slate-800">₹{b.mrp.toFixed(2)}</span>
                    <span className="bg-slate-100 px-2 py-0.5 rounded-md text-xs">
                      {b.quantity - b.reservedQuantity} avail.
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main drawer ───────────────────────────────────────────────────────────────

export function AlternativesDrawer({
  sourceMed,
  autoSuggest = false,
  onClose,
}: {
  sourceMed:    MedicineSearchResult;
  autoSuggest?: boolean;
  onClose:      () => void;
}) {
  const [cursor, setCursor] = useState(0);

  const addItem    = useBillingStore((s) => s.addItem);
  const removeItem = useBillingStore((s) => s.removeItem);
  const sourceCartItem = useBillingStore((s) =>
    s.items.find((i) => i.medicineName.toLowerCase() === sourceMed.name.toLowerCase()) ?? null
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: ["alternatives", sourceMed.id],
    queryFn: async () => {
      const res = await api.get<{ data: AlternativeResult[] }>(
        `/medicines/${sourceMed.id}/alternatives`,
      );
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const sorted = data ? sortAlternatives(data) : [];

  useEffect(() => { setCursor(0); }, [sorted.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, sorted.length - 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, sorted.length]);

  function addBatchToCart(alt: AlternativeResult, batch: AlternativeBatch) {
    addItem({
      inventoryId:    batch.id,
      medicineName:   alt.name,
      hsnCode:        alt.hsnCode,
      schedule:       alt.schedule,
      packSize:       alt.packSize ?? undefined,
      location:       batch.location ?? undefined,
      batchNumber:    batch.batchNumber,
      expiryDate:     batch.expiryDate,
      mrp:            batch.mrp,
      quantity:       1,
      discount:       0,
      gstRate:        alt.gstRate,
      availableStock: batch.quantity - batch.reservedQuantity,
    });
    onClose();
  }

  function replaceBatchInCart(alt: AlternativeResult, batch: AlternativeBatch) {
    if (sourceCartItem) removeItem(sourceCartItem.inventoryId);
    addBatchToCart(alt, batch);
  }

  return createPortal(
    <>
      {/* Backdrop */}
      <motion.div
        key="alt-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[299] bg-black/20"
        onClick={onClose}
      />

      {/* Drawer */}
      <motion.div
        key="alt-drawer"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.22, ease: "easeOut" }}
        className="fixed inset-y-0 right-0 z-[300] flex flex-col bg-white"
        style={{ width: 440, boxShadow: "-8px 0 48px rgba(0,0,0,0.14)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-300 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Pill className="w-4 h-4 text-blue-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-0.5">
              Alternatives for
            </p>
            <p className="text-[15px] font-bold text-slate-900 truncate leading-snug">
              {sourceMed.name}
            </p>
            {sourceMed.genericName && (
              <p className="text-xs text-slate-600 mt-0.5 truncate">
                {[sourceMed.genericName, sourceMed.strength, sourceMed.form]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-100 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition-colors flex-shrink-0 mt-0.5"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Out-of-stock auto-suggest banner ───────────────── */}
        <AnimatePresence>
          {autoSuggest && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden flex-shrink-0"
            >
              <div className="flex items-center gap-2.5 px-5 py-2.5 bg-amber-100 border-b border-amber-300">
                <Sparkles className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <p className="text-xs font-semibold text-amber-900">
                  <strong className="font-bold">{sourceMed.name}</strong> is out of stock — suggested alternatives below
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Legend ─────────────────────────────────────────── */}
        {!isLoading && sorted.length > 0 && (
          <div className="flex items-center gap-3 px-5 py-2.5 bg-slate-100 border-b border-slate-300 flex-shrink-0">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wide mr-1">
              Sorted
            </span>
            {(["in_stock", "low_stock", "out_of_stock"] as const).map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <span className={cn(
                  "w-2.5 h-2.5 rounded-full",
                  s === "in_stock" ? "bg-emerald-500" : s === "low_stock" ? "bg-amber-400" : "bg-red-500"
                )} />
                <span className="text-xs text-slate-600 capitalize">{s.replace(/_/g, " ")}</span>
              </div>
            ))}
            <span className="ml-auto text-xs text-slate-500">↑↓ navigate · ESC close</span>
          </div>
        )}

        {/* ── Body ───────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
              <p className="text-sm text-slate-500">Loading alternatives…</p>
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <AlertCircle className="w-6 h-6 text-red-400" />
              <p className="text-sm font-semibold text-red-500">Failed to load alternatives</p>
              <p className="text-xs text-slate-500">Check your connection and try again</p>
            </div>
          )}

          {!isLoading && !isError && sorted.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
              <Package className="w-10 h-10 text-slate-200" />
              <p className="text-sm font-semibold text-slate-500">No alternatives found</p>
              <p className="text-xs text-slate-400 max-w-[220px] leading-relaxed">
                No other medicines with the same generic name, strength, and dosage form were found in the catalogue.
              </p>
            </div>
          )}

          {!isLoading && !isError && sorted.map((alt, i) => (
            <AlternativeCard
              key={alt.id}
              alt={alt}
              isHighlighted={i === cursor}
              onHover={() => setCursor(i)}
              onAdd={(batch)     => addBatchToCart(alt, batch)}
              onReplace={
                sourceCartItem
                  ? (batch) => replaceBatchInCart(alt, batch)
                  : null
              }
            />
          ))}
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        {!isLoading && sorted.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-300 bg-slate-100 flex-shrink-0">
            <p className="text-xs text-slate-600 text-center">
              Ranked by availability · stock level · margin · price
            </p>
          </div>
        )}
      </motion.div>
    </>,
    document.body,
  );
}
