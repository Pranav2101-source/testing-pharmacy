"use client";

import { useState, useRef, useEffect, memo } from "react";
import {
  Search, Loader2, Pill, ChevronRight, ScanBarcode,
  X, AlertTriangle, Clock, Shuffle, Layers,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
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
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 bg-gradient-to-br from-blue-50/80 to-white">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0 shadow-sm shadow-blue-200">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-0.5">Select a Batch</p>
            <p className="font-bold text-slate-900 text-[15px] truncate">{med.name}</p>
            <p className="text-[11px] text-slate-400">{batches.length} batch{batches.length !== 1 ? "es" : ""} available — oldest expiry shown first</p>
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

export function MedicineSearchCombobox({
  onOpenAlternatives,
}: {
  onOpenAlternatives?: (med: MedicineSearchResult, autoSuggest?: boolean) => void;
}) {
  const [query,    setQuery]    = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open,     setOpen]     = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [focused,  setFocused]  = useState(false);
  const [cursor,   setCursor]   = useState(0);

  const [pickerState,      setPickerState]      = useState<PickerState | null>(null);
  const [nearExpiryWarn,   setNearExpiryWarn]   = useState<{ name: string; days: number } | null>(null);
  const [stockError,       setStockError]       = useState<string | null>(null);

  const addItem      = useBillingStore((s) => s.addItem);
  const queryClient  = useQueryClient();
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
  const lastKeyTimeRef   = useRef<number>(0);
  const barcodeCharCount = useRef<number>(0);
  const isBarcodeRef     = useRef<boolean>(false);
  const [isBarcode, setIsBarcode] = useState(false);

  // Debounce: commit query to debouncedQuery after typing pauses
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim()) { setDebouncedQuery(""); setOpen(false); return; }
    const delay = isBarcodeRef.current ? 60 : 300;
    timerRef.current = setTimeout(() => setDebouncedQuery(query.trim()), delay);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query]);

  // React Query: cached medicine search — no manual loading/results state
  const { data: searchData, isFetching: loading } = useQuery({
    queryKey: ["medicine-search", debouncedQuery],
    queryFn:  () =>
      api.get<{ data: MedicineSearchResult[] }>("/medicines/search", {
        params: { q: debouncedQuery, limit: 8 },
      }).then((r) => r.data.data),
    enabled:         debouncedQuery.length > 0,
    staleTime:       60_000,
    // Only keep previous data while a new query is actively fetching —
    // never when the query is disabled (empty input), which would leave
    // stale results visible even after the user clears the search box.
    placeholderData: debouncedQuery.length > 0 ? keepPreviousData : undefined,
  });
  // Never expose results when there is no active query — guards against
  // placeholder data leaking through when the input is empty.
  const results = debouncedQuery.length > 0 ? (searchData ?? []) : [];

  // Open dropdown when results arrive; close when query is cleared
  useEffect(() => {
    if (results.length > 0 && debouncedQuery) setOpen(true);
  }, [results, debouncedQuery]);

  // Reset cursor to top whenever the results list changes
  useEffect(() => { setCursor(0); }, [results]);

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
      schedule:       med.schedule,
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

  // ── Fetch batches for a medicine (cached 30 s so repeat clicks are instant) ──

  function fetchBatches(name: string) {
    return queryClient.fetchQuery({
      queryKey: queryKeys.medicineStock.byName(name),
      queryFn:  () =>
        api.get<{ data: { items: InventoryBatch[] } }>("/inventory", {
          params: { search: name, inStock: true, limit: 20 },
        }).then((r) => r.data.data.items),
      staleTime: 30_000,
    });
  }

  // Prefetch batches when the pharmacist hovers a result — by the time they
  // click, the data is already in cache and the batch picker appears instantly.
  function prefetchBatches(name: string) {
    void queryClient.prefetchQuery({
      queryKey: queryKeys.medicineStock.byName(name),
      queryFn:  () =>
        api.get<{ data: { items: InventoryBatch[] } }>("/inventory", {
          params: { search: name, inStock: true, limit: 20 },
        }).then((r) => r.data.data.items),
      staleTime: 30_000,
    });
  }

  // ── Select medicine from dropdown → fetch batches ─────────────────────────

  async function selectMedicine(med: MedicineSearchResult) {
    setOpen(false);
    setQuery("");
    setDebouncedQuery("");   // clears React Query key → dropdown stays closed
    isBarcodeRef.current  = false;
    barcodeCharCount.current = 0;
    setIsBarcode(false);
    setAddingId(med.id);

    try {
      const allBatches = await fetchBatches(med.name);

      const now         = new Date();
      // Sort FIFO (earliest expiry first) — already ordered by API, but be explicit
      const liveBatches = allBatches
        .filter((b) => new Date(b.expiryDate) > now)
        .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());

      if (liveBatches.length === 0) {
        // If the medicine has a genericName, open the alternatives drawer automatically
        // instead of showing a plain error — keeps the billing flow moving.
        if ((med.hasAlternatives || med.genericName) && onOpenAlternatives) {
          onOpenAlternatives(med, true);
        } else if (allBatches.length > 0) {
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

    if (open && results.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, results.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
        return;
      }
      // Right Arrow → open alternatives for the focused result
      if (e.key === "ArrowRight") {
        const focused = results[cursor];
        if ((focused?.hasAlternatives || focused?.genericName) && onOpenAlternatives) {
          e.preventDefault();
          onOpenAlternatives(focused);
          setOpen(false);
          setQuery("");
          return;
        }
      }
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const target = results[cursor] ?? results[0];
      if (target) selectMedicine(target);
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

        {/* ── Input row — CSS-only transitions, zero FM overhead ──── */}
        <div className={cn(
          "flex items-center gap-3 px-4 py-3 rounded-none transition-all duration-150",
          focused
            ? "bg-blue-50/60 shadow-[inset_0_-2px_0_0_rgba(37,99,235,0.4)]"
            : "bg-transparent"
        )}>
          {/* Icon: loader / barcode / search — CSS opacity swap, no FM */}
          <div className="w-6 h-6 flex-shrink-0 relative">
            <Loader2 className={cn(
              "w-6 h-6 text-blue-500 animate-spin absolute inset-0 transition-opacity duration-150",
              (loading || addingId) ? "opacity-100" : "opacity-0 pointer-events-none"
            )} />
            <ScanBarcode className={cn(
              "w-6 h-6 text-emerald-500 absolute inset-0 transition-opacity duration-150",
              (!loading && !addingId && isBarcode) ? "opacity-100" : "opacity-0 pointer-events-none"
            )} />
            <Search className={cn(
              "w-5 h-5 text-blue-400 absolute inset-0 m-0.5 transition-opacity duration-150",
              (!loading && !addingId && !isBarcode) ? "opacity-100" : "opacity-0 pointer-events-none"
            )} />
          </div>

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

          {isBarcode && (
            <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-wide flex-shrink-0 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full animate-fade-in">
              Barcode
            </span>
          )}
        </div>

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
          {open && debouncedQuery.length > 0 && (loading || results.length > 0) && (
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
                    <li
                      key={med.id}
                      onMouseEnter={() => { setCursor(i); prefetchBatches(med.name); }}
                      onMouseDown={() => selectMedicine(med)}
                      style={{ animationDelay: `${i * 20}ms`, animationFillMode: "both" }}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-slate-50 last:border-0 group",
                        "transition-colors duration-75 animate-fade-in",
                        i === cursor ? "bg-blue-100/70" : "hover:bg-blue-50/50"
                      )}
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                        i === cursor ? "bg-blue-100" : "bg-blue-50 group-hover:bg-blue-100"
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
                        {i === cursor && (
                          <span className="pill bg-emerald-100 text-emerald-600 uppercase tracking-wide">↵</span>
                        )}

                        {/* Alternatives — shown when alternatives confirmed, or medicine has a genericName */}
                        {(med.hasAlternatives || med.genericName) && (
                          <button
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              onOpenAlternatives?.(med);
                              setOpen(false);
                              setQuery("");
                            }}
                            title={med.hasAlternatives ? "View Alternatives (→)" : "Find Alternatives (→)"}
                            className={cn(
                              "flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-bold transition-colors flex-shrink-0",
                              med.hasAlternatives
                                ? "bg-violet-100 hover:bg-violet-200 text-violet-700"
                                : "bg-slate-100 hover:bg-slate-200 text-slate-500"
                            )}
                          >
                            <Shuffle className="w-3 h-3" />
                            Alt
                          </button>
                        )}

                        <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-400 transition-colors" />
                      </div>
                    </li>
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
