"use client";

import { useState, useRef, useEffect, useCallback, memo } from "react";
import {
  Search, Loader2, Pill, ChevronRight, ScanBarcode,
  X, AlertTriangle, Clock,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useBillingStore } from "./useBillingStore";
import { cn } from "@/lib/utils";
import type { MedicineSearchResult } from "@pharmacy/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type InventoryBatch = {
  id:               string;
  batchNumber:      string;
  expiryDate:       string;
  mrp:              number;
  quantity:         number;
  reservedQuantity?: number;
  location?:        string;
  medicine: {
    name:     string;
    hsnCode:  string | null;
    gstRate:  number;
    isActive: boolean;
  };
};

type PickerState = {
  med:     MedicineSearchResult;
  batches: InventoryBatch[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const NEAR_EXPIRY_DAYS = 90;

function expiryStatus(isoDate: string) {
  const ms       = new Date(isoDate).getTime() - Date.now();
  const days     = Math.ceil(ms / 86400000);
  if (days <= 0)                  return { label: "EXPIRED",  days,  color: "red"   } as const;
  if (days <= 30)                 return { label: "CRITICAL", days,  color: "red"   } as const;
  if (days <= NEAR_EXPIRY_DAYS)   return { label: "EXPIRING", days,  color: "amber" } as const;
  return                                 { label: "OK",        days,  color: "green" } as const;
}

function fmtExpiry(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonResult() {
  return (
    <li className="flex items-center gap-3 px-4 py-3 border-b border-slate-50">
      <div className="skeleton w-8 h-8 rounded-lg flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="skeleton h-3 w-3/4 rounded-md" />
        <div className="skeleton h-2 w-1/2 rounded-md" />
      </div>
    </li>
  );
}

// ── Batch Picker Dialog ───────────────────────────────────────────────────────
// memo: props only change when a different medicine is selected — prevents
// re-renders triggered by parent search query / results state changes.

const BatchPickerDialog = memo(function BatchPickerDialog({
  med,
  batches,
  onSelect,
  onClose,
}: {
  med:      MedicineSearchResult;
  batches:  InventoryBatch[];
  onSelect: (batch: InventoryBatch) => void;
  onClose:  () => void;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <Pill className="w-4 h-4 text-blue-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-slate-900 text-[14px] truncate">{med.name}</p>
            <p className="text-[11px] text-slate-400">{batches.length} batch{batches.length !== 1 ? "es" : ""} available — select one</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center flex-shrink-0 transition-colors"
          >
            <X className="w-3.5 h-3.5 text-slate-500" />
          </button>
        </div>

        {/* Batch list */}
        <div className="p-2 max-h-[400px] overflow-y-auto">
          {batches.map((batch) => {
            const status      = expiryStatus(batch.expiryDate);
            const discontinued = !batch.medicine.isActive;
            const isDisabled  = status.color === "red" || discontinued;

            return (
              <button
                key={batch.id}
                onClick={() => !isDisabled && onSelect(batch)}
                disabled={isDisabled}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left",
                  isDisabled
                    ? "opacity-50 cursor-not-allowed bg-slate-50"
                    : "hover:bg-blue-50 active:bg-blue-100 cursor-pointer"
                )}
              >
                {/* Expiry color strip */}
                <div className={cn(
                  "w-1 self-stretch rounded-full flex-shrink-0",
                  status.color === "red"   ? "bg-red-400"   :
                  status.color === "amber" ? "bg-amber-400" : "bg-emerald-400"
                )} />

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[13px] text-slate-800">
                      Batch {batch.batchNumber}
                    </span>

                    {discontinued && (
                      <span className="text-[9px] font-bold bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                        Discontinued
                      </span>
                    )}

                    {!discontinued && status.label === "EXPIRED" && (
                      <span className="text-[9px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                        Expired
                      </span>
                    )}
                    {!discontinued && status.label === "CRITICAL" && (
                      <span className="text-[9px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                        {status.days}d left
                      </span>
                    )}
                    {!discontinued && status.label === "EXPIRING" && (
                      <span className="text-[9px] font-bold bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                        {status.days}d left
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5 mt-0.5 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Exp: {fmtExpiry(batch.expiryDate)}
                    </span>
                    {batch.location && <span>· {batch.location}</span>}
                  </div>
                </div>

                {/* MRP + qty */}
                <div className="text-right flex-shrink-0">
                  <div className="font-bold text-[14px] text-slate-800">₹{batch.mrp.toFixed(2)}</div>
                  <div className="text-[11px] text-slate-400">
                    {batch.quantity - (batch.reservedQuantity ?? 0)} available
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
});

// ── Main Component ────────────────────────────────────────────────────────────

export function MedicineSearchCombobox() {
  const [query,    setQuery]    = useState("");
  const [open,     setOpen]     = useState(false);
  const [results,  setResults]  = useState<MedicineSearchResult[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [focused,  setFocused]  = useState(false);

  const [pickerState,      setPickerState]      = useState<PickerState | null>(null);
  const [nearExpiryWarn,   setNearExpiryWarn]   = useState<{ name: string; days: number } | null>(null);
  const [stockError,       setStockError]       = useState<string | null>(null);

  const addItem      = useBillingStore((s) => s.addItem);
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  // Auto-dismiss near-expiry warning after 5 s
  useEffect(() => {
    if (!nearExpiryWarn) return;
    const t = setTimeout(() => setNearExpiryWarn(null), 5000);
    return () => clearTimeout(t);
  }, [nearExpiryWarn]);

  // Auto-dismiss stock error after 4 s
  useEffect(() => {
    if (!stockError) return;
    const t = setTimeout(() => setStockError(null), 4000);
    return () => clearTimeout(t);
  }, [stockError]);

  // Barcode scanner detection — scanners fire chars < 50 ms apart, then Enter
  const lastKeyTimeRef    = useRef<number>(0);
  const barcodeCharCount  = useRef<number>(0);
  const isBarcodeRef      = useRef<boolean>(false);
  const [isBarcode, setIsBarcode] = useState(false);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    setLoading(true);
    try {
      const { data } = await api.get<{ data: MedicineSearchResult[] }>("/medicines/search", {
        params: { q, limit: 8 },
      });
      setResults(data.data);
      setOpen(data.data.length > 0);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const delay = isBarcodeRef.current ? 60 : 300;
    timerRef.current = setTimeout(() => search(query), delay);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query, search]);

  useEffect(() => {
    const onOut = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, []);

  // ── Add a confirmed batch to cart ─────────────────────────────────────────

  function addBatch(batch: InventoryBatch, med: MedicineSearchResult) {
    if (!batch.medicine.isActive) {
      setStockError(`"${batch.medicine.name}" is discontinued and cannot be billed.`);
      return;
    }

    const status = expiryStatus(batch.expiryDate);
    if (status.color === "red") {
      setStockError(`Batch ${batch.batchNumber} expired on ${fmtExpiry(batch.expiryDate)}.`);
      return;
    }

    addItem({
      inventoryId:    batch.id,
      medicineName:   batch.medicine.name,
      hsnCode:        batch.medicine.hsnCode,
      packSize:       med.packSize ?? undefined,
      location:       batch.location,
      batchNumber:    batch.batchNumber,
      expiryDate:     batch.expiryDate,
      mrp:            batch.mrp,
      quantity:       1,
      discount:       0,
      gstRate:        batch.medicine.gstRate,
      availableStock: batch.quantity - (batch.reservedQuantity ?? 0),
    });

    if (status.color !== "green") {
      setNearExpiryWarn({ name: batch.medicine.name, days: status.days });
    }

    inputRef.current?.focus();
  }

  // ── Select medicine from dropdown → fetch batches ─────────────────────────

  async function selectMedicine(med: MedicineSearchResult) {
    setOpen(false);
    setQuery("");
    setResults([]);
    isBarcodeRef.current  = false;
    barcodeCharCount.current = 0;
    setIsBarcode(false);
    setAddingId(med.id);

    try {
      const { data } = await api.get<{ data: { items: InventoryBatch[] } }>("/inventory", {
        params: { search: med.name, inStock: true, limit: 20 },
      });

      const now         = new Date();
      const allBatches  = data.data.items;
      // Sort FIFO (earliest expiry first) — already ordered by API, but be explicit
      const liveBatches = allBatches
        .filter((b) => new Date(b.expiryDate) > now)
        .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());

      if (liveBatches.length === 0) {
        if (allBatches.length > 0) {
          setStockError(`All batches of "${med.name}" are expired.`);
        } else {
          setStockError(`No stock available for "${med.name}".`);
        }
        return;
      }

      if (liveBatches.length === 1 && liveBatches[0]) {
        addBatch(liveBatches[0], med);
      } else {
        setPickerState({ med, batches: liveBatches });
      }
    } catch {
      setStockError(`Failed to load stock for "${med.name}". Try again.`);
    } finally {
      setAddingId(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const now  = Date.now();
    const diff = now - lastKeyTimeRef.current;
    lastKeyTimeRef.current = now;

    if (diff > 0 && diff < 50) {
      barcodeCharCount.current++;
      if (barcodeCharCount.current >= 4 && !isBarcodeRef.current) {
        isBarcodeRef.current = true;
        setIsBarcode(true);
      }
    } else {
      barcodeCharCount.current = 0;
      if (isBarcodeRef.current) {
        isBarcodeRef.current = false;
        setIsBarcode(false);
      }
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const first = results[0];
      if (first) selectMedicine(first);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      setIsBarcode(false);
    }
  }

  return (
    <>
      {/* Batch picker dialog — rendered outside combobox container so z-index is clean */}
      <AnimatePresence>
        {pickerState && (
          <BatchPickerDialog
            med={pickerState.med}
            batches={pickerState.batches}
            onSelect={(batch) => {
              addBatch(batch, pickerState.med);
              setPickerState(null);
            }}
            onClose={() => setPickerState(null)}
          />
        )}
      </AnimatePresence>

      <div ref={containerRef} className="relative flex-1">

        {/* ── Input row ─────────────────────────────────────────── */}
        <motion.div
          animate={focused ? { backgroundColor: "rgba(219,234,254,0.6)" } : { backgroundColor: "transparent" }}
          transition={{ duration: 0.18 }}
          className={cn(
            "flex items-center gap-3 px-4 py-3 rounded-none transition-shadow duration-200",
            focused && "shadow-[inset_0_-2px_0_0_rgba(37,99,235,0.4)]"
          )}
        >
          <AnimatePresence mode="wait" initial={false}>
            {loading || addingId ? (
              <motion.div key="loader" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                <Loader2 className="w-6 h-6 text-blue-500 animate-spin flex-shrink-0" />
              </motion.div>
            ) : isBarcode ? (
              <motion.div key="barcode" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                <ScanBarcode className="w-6 h-6 text-emerald-500 flex-shrink-0" />
              </motion.div>
            ) : (
              <motion.div key="search" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                <Search className="w-5 h-5 text-blue-400 flex-shrink-0" />
              </motion.div>
            )}
          </AnimatePresence>

          <input
            ref={inputRef}
            data-billing-search
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => { setFocused(true); if (results.length > 0) setOpen(true); }}
            onBlur={() => setFocused(false)}
            placeholder="Search item here. (e.g 'gly' or 'g+99' or '8908009149206' or 'c,paracetamol')"
            className="flex-1 text-[15px] text-slate-700 placeholder-blue-400/70 bg-transparent focus:outline-none"
          />

          <AnimatePresence>
            {isBarcode && (
              <motion.span
                initial={{ opacity: 0, x: 6, scale: 0.85 }}
                animate={{ opacity: 1, x: 0,  scale: 1    }}
                exit={   { opacity: 0, x: 6,  scale: 0.85 }}
                className="text-[9px] font-bold text-emerald-600 uppercase tracking-wide flex-shrink-0 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full"
              >
                Barcode
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ── Inline toasts (stock error + near-expiry) ─────────── */}
        <AnimatePresence>
          {stockError && (
            <motion.div
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              className="absolute z-50 left-4 right-4 top-full mt-1 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-[12px] font-medium px-3 py-2 rounded-xl shadow-md"
            >
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-red-500" />
              <span className="flex-1">{stockError}</span>
              <button onClick={() => setStockError(null)} className="text-red-400 hover:text-red-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
          {!stockError && nearExpiryWarn && (
            <motion.div
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              className="absolute z-50 left-4 right-4 top-full mt-1 flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-[12px] font-medium px-3 py-2 rounded-xl shadow-md"
            >
              <Clock className="w-3.5 h-3.5 flex-shrink-0 text-amber-500" />
              <span className="flex-1">
                <strong>{nearExpiryWarn.name}</strong> expires in {nearExpiryWarn.days} day{nearExpiryWarn.days !== 1 ? "s" : ""}.
              </span>
              <button onClick={() => setNearExpiryWarn(null)} className="text-amber-400 hover:text-amber-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Search dropdown ───────────────────────────────────── */}
        <AnimatePresence>
          {open && (loading || results.length > 0) && (
            <motion.ul
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0   }}
              exit={   { opacity: 0, y: -4  }}
              transition={{ duration: 0.14 }}
              className="absolute z-50 left-0 right-0 top-full bg-white border border-slate-200 rounded-xl shadow-card-lg overflow-hidden max-h-72 overflow-y-auto"
            >
              {loading && results.length === 0
                ? [0, 1, 2].map((i) => <SkeletonResult key={i} />)
                : results.map((med, i) => (
                    <motion.li
                      key={med.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.025 }}
                      onMouseDown={() => selectMedicine(med)}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-slate-50 last:border-0 group",
                        "transition-colors duration-100",
                        i === 0 ? "bg-blue-50/50 hover:bg-blue-100/70" : "hover:bg-blue-50/50"
                      )}
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                        i === 0 ? "bg-blue-100" : "bg-blue-50 group-hover:bg-blue-100"
                      )}>
                        <Pill className="w-4 h-4 text-blue-500" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-[15px] font-semibold text-slate-800 truncate">{med.name}</p>
                        <p className="text-[12px] text-slate-400 truncate">
                          {[
                            med.genericName,
                            med.manufacturer,
                            med.form && med.strength ? `${med.form} · ${med.strength}` : med.form,
                          ].filter(Boolean).join(" · ")}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {med.packSize && (
                          <span className="pill bg-slate-100 text-slate-500 text-[12px]">{med.packSize}</span>
                        )}
                        <span className="pill bg-blue-100 text-blue-600 text-[12px]">GST {med.gstRate}%</span>
                        {i === 0 && (
                          <span className="pill bg-emerald-100 text-emerald-600 uppercase tracking-wide">↵</span>
                        )}
                        <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-400 transition-colors" />
                      </div>
                    </motion.li>
                  ))}
            </motion.ul>
          )}

          {open && !loading && results.length === 0 && query.trim() && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0  }}
              exit={   { opacity: 0, y: -4 }}
              className="absolute z-50 left-0 right-0 top-full bg-white border border-slate-200 rounded-xl shadow-card-md px-4 py-5 text-center"
            >
              <p className="text-sm text-slate-500">
                No medicines found for <strong className="text-slate-700">&quot;{query}&quot;</strong>
              </p>
              <p className="text-[11px] text-slate-400 mt-1">Try generic name, barcode, or manufacturer</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
