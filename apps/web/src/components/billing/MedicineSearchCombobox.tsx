"use client";

import { useState, useRef, useEffect, useMemo, memo } from "react";
import {
  Search, Loader2, Pill, ChevronRight, ScanBarcode,
  X, AlertTriangle, Clock, Shuffle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { api } from "@/lib/api-client";
import { useBillingStore } from "./useBillingStore";
import { cn } from "@/lib/utils";
import type { MedicineSearchResult } from "@pharmacy/types";
import { BatchPickerDialog, type InventoryBatch, expiryStatus, fmtExpiry, getLocationLabel } from "./BatchPickerDialog";
import { BarcodeInput } from "@/components/BarcodeInput";
import { ProductTag } from "@/lib/product-taxonomy";
import { ClassifyModal, type ClassifyTarget } from "@/components/ClassifyModal";
import { getStoredUser } from "@/lib/auth";
import { playScanBeep } from "@/lib/sound";
import { Tag } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type PickerState = {
  med:     MedicineSearchResult;
  batches: InventoryBatch[];
};

// ── Stock display ────────────────────────────────────────────────────────────
// Purely presentational — every number here (inStock/availableQuantity/
// sellableUnits/price) is computed backend-side in one batched query
// (MedicineService#quickSearch); this just formats what the API already sent.

function stockLabel(med: MedicineSearchResult): { text: string; title?: string } | null {
  if (typeof med.inStock !== "boolean") return null;
  if (!med.inStock) return { text: "Out of stock" };
  const qty = med.availableQuantity ?? 0;
  if (med.allowLooseSale && med.sellableUnits != null && med.unitsPerPack) {
    return {
      text: `${qty}×${med.unitsPerPack}=${med.sellableUnits}`,
      title: `${qty} pack${qty === 1 ? "" : "s"} × ${med.unitsPerPack} = ${med.sellableUnits} sellable units`,
    };
  }
  return { text: `${qty} in stock` };
}

function fmtPrice(price: number | null | undefined) {
  return price != null ? `₹${price.toFixed(2)}` : null;
}

// Batch selection order is decided BACKEND-side now — GET /dispensing/batches
// returns this medicine's sellable batches (ACTIVE, in date, unreserved stock)
// already sorted by the pharmacy's configured strategy (LILA/FEFO or LIFA). The
// combobox no longer sorts or filters batches itself; see DispensingService.

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

// ── Main Component ────────────────────────────────────────────────────────────

export function MedicineSearchCombobox({
  lifa = false,
  onOpenAlternatives,
}: {
  /** LIFA (true) dispenses the newest batch first; LILA/default (false) is FEFO —
   *  oldest/soonest-expiring batch first. See BillingSubNav's toggle. */
  lifa?: boolean;
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
  const [classifyTarget,   setClassifyTarget]   = useState<ClassifyTarget | null>(null);

  const canClassify = ["OWNER", "MANAGER"].includes(getStoredUser()?.role ?? "");

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
  // Visible scan mode — reveals a dedicated barcode box (mirrors the GRN screen)
  // so counter staff can plainly see they can scan, not just rely on auto-detect.
  const [scanMode, setScanMode] = useState(false);

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
      // includeLocal: this pharmacy's own not-yet-catalogued medicines (see
      // PharmacyMedicine) are billable stock too — the batch picker fix isn't enough
      // if the medicine never shows up in this dropdown to begin with.
      api.get<{ data: MedicineSearchResult[] }>("/medicines/search", {
        params: { q: debouncedQuery, limit: 8, includeLocal: true },
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
  const results = useMemo(
    () => (debouncedQuery.length > 0 ? (searchData ?? []) : []),
    [debouncedQuery, searchData],
  );

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

  function addBatch(batch: InventoryBatch, med: MedicineSearchResult, autoSelected = true) {
    if (!batch.medicine.isActive) {
      setStockError(`"${batch.medicine.name}" is discontinued and cannot be billed.`);
      return;
    }

    const status = expiryStatus(batch.expiryDate);
    if (status.color === "red") {
      setStockError(`Batch ${batch.batchNumber} expired on ${fmtExpiry(batch.expiryDate)}.`);
      return;
    }

    const allowLooseSale = batch.medicine.allowLooseSale ?? med.allowLooseSale ?? false;
    const looseByDefault = batch.medicine.looseByDefault ?? med.looseByDefault ?? false;
    addItem({
      inventoryId:    batch.id,
      medicineId:     med.isLocal ? undefined : med.id,
      medicineName:   batch.medicine.name,
      hsnCode:        batch.medicine.hsnCode,
      schedule:       med.schedule,
      packSize:       med.packSize ?? undefined,
      location:       getLocationLabel(batch) ?? undefined,
      batchNumber:    batch.batchNumber,
      expiryDate:     batch.expiryDate,
      mrp:            batch.mrp,
      quantity:       1,
      discount:       0,
      gstRate:        batch.medicine.gstRate,
      availableStock: batch.quantity - (batch.reservedQuantity ?? 0),
      // Starts loose only if the pharmacy set this medicine to default that way.
      saleUnit:       allowLooseSale && looseByDefault ? "LOOSE" : "PACK",
      unitsPerPack:   batch.medicine.unitsPerPack ?? med.unitsPerPack ?? undefined,
      baseUnit:       batch.medicine.baseUnit ?? med.baseUnit ?? undefined,
      allowLooseSale,
      looseUnits:     batch.looseUnits ?? 0,
      // The engine's ordered list; false only when the pharmacist picked a row
      // other than its top choice in the batch picker.
      batchAutoSelected: autoSelected,
    });

    if (status.color !== "green") {
      setNearExpiryWarn({ name: batch.medicine.name, days: status.days });
    }

    // In scan mode, leave focus on the dedicated barcode box so the next scan
    // lands there. Otherwise, jump straight into the new line's Qty box — the
    // cashier almost always needs to set it to the prescribed count next, and
    // returning focus to search just made that a mouse click on every single
    // line. Falls back to the search box if the row hasn't painted yet.
    if (!scanMode) {
      requestAnimationFrame(() => {
        const qty = document.querySelector<HTMLInputElement>(
          `[data-inventory-id="${batch.id}"] [data-col="qty"]`,
        );
        if (qty) { qty.focus(); qty.select(); } else { inputRef.current?.focus(); }
      });
    }
  }

  // ── Fetch batches for a medicine (cached 30 s so repeat clicks are instant) ──
  //
  // GET /dispensing/batches returns this medicine's sellable batches already
  // filtered (ACTIVE, in date, unreserved stock) AND already ordered by the
  // pharmacy's configured strategy (LILA/FEFO or LIFA). The combobox does not
  // sort, filter by expiry, or reason about the strategy — the backend engine is
  // authoritative. See DispensingService.

  function dispensingBatchesParams(med: MedicineSearchResult) {
    return med.isLocal ? { localMedicineId: med.id } : { medicineId: med.id };
  }

  function fetchDispensingBatches(med: MedicineSearchResult) {
    return queryClient.fetchQuery({
      queryKey: queryKeys.dispensing.batches(med.id, !!med.isLocal),
      queryFn:  () =>
        api.get<{ data: InventoryBatch[] }>("/dispensing/batches", {
          params: dispensingBatchesParams(med),
        }).then((r) => r.data.data),
      staleTime: 30_000,
    });
  }

  // Prefetch batches when the pharmacist hovers a result — by the time they
  // click, the data is already in cache and the batch picker appears instantly.
  function prefetchBatches(med: MedicineSearchResult) {
    void queryClient.prefetchQuery({
      queryKey: queryKeys.dispensing.batches(med.id, !!med.isLocal),
      queryFn:  () =>
        api.get<{ data: InventoryBatch[] }>("/dispensing/batches", {
          params: dispensingBatchesParams(med),
        }).then((r) => r.data.data),
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
      // Already sellable + strategy-ordered by the backend engine.
      const liveBatches = await fetchDispensingBatches(med);

      if (liveBatches.length === 0) {
        // If the medicine has a genericName, open the alternatives drawer automatically
        // instead of showing a plain error — keeps the billing flow moving.
        if (!med.isLocal && (med.hasAlternatives || med.genericName) && onOpenAlternatives) {
          onOpenAlternatives(med, true);
        } else {
          setStockError(`No sellable stock for "${med.name}".`);
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

  // ── ← from the results list: always show the batch picker ────────────────
  // selectMedicine skips the picker and quick-adds when only one batch exists —
  // the fast path for the common case. Pressing ← is a deliberate "let me see the
  // batches" ask, so it shows the picker even for a single batch instead of
  // auto-adding it.
  async function openBatchPicker(med: MedicineSearchResult) {
    setOpen(false);
    setQuery("");
    setDebouncedQuery("");
    isBarcodeRef.current  = false;
    barcodeCharCount.current = 0;
    setIsBarcode(false);
    setAddingId(med.id);

    try {
      const liveBatches = await fetchDispensingBatches(med);

      if (liveBatches.length === 0) {
        if (!med.isLocal && (med.hasAlternatives || med.genericName) && onOpenAlternatives) {
          onOpenAlternatives(med, true);
        } else {
          setStockError(`No sellable stock for "${med.name}".`);
        }
        return;
      }
      setPickerState({ med, batches: liveBatches });
    } catch {
      setStockError(`Failed to load stock for "${med.name}". Try again.`);
    } finally {
      setAddingId(null);
    }
  }

  // ── Exact barcode lookup ──────────────────────────────────────────────────
  // A scanner types the barcode into the search box then fires Enter. The fuzzy
  // /medicines/search endpoint does NOT match on barcode, so we resolve the code
  // against the authoritative exact-match endpoint and feed the medicine straight
  // into the normal batch-selection flow. This is what makes "scan → line added"
  // actually work — searching the raw code would either miss or match the wrong item.
  async function handleBarcodeScan(code: string) {
    setOpen(false);
    setAddingId("barcode");
    // Clear the input immediately so the next scan starts clean and the stale
    // code never leaks into the fuzzy search dropdown.
    setQuery("");
    setDebouncedQuery("");
    isBarcodeRef.current     = false;
    barcodeCharCount.current = 0;
    setIsBarcode(false);

    try {
      const res = await api.get<{ data: MedicineSearchResult & { isActive?: boolean } }>(
        `/medicines/barcode/${encodeURIComponent(code)}`,
      );
      const m = res.data.data;
      if (m.isActive === false) {
        setStockError(`"${m.name}" is discontinued and cannot be billed.`);
        return;
      }
      // The barcode resolved to a real, sellable medicine — confirm it audibly so a
      // cashier scanning several items in a row doesn't need to watch the screen
      // after every scan. Fires here (decode success), not after the batch/stock
      // resolution below, matching how a hardware scanner's own buzzer works.
      playScanBeep();
      // selectMedicine fetches live batches → adds directly if one batch, else
      // opens the batch picker. Identical to a manual pick, so all downstream
      // expiry/stock guards apply.
      await selectMedicine(m);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        setStockError(`No medicine is linked to barcode "${code}". Search by name, then set this barcode on the medicine so future scans work.`);
      } else {
        setStockError(`Couldn't look up barcode "${code}". Check your connection and scan again.`);
      }
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
        if (!focused?.isLocal && (focused?.hasAlternatives || focused?.genericName) && onOpenAlternatives) {
          e.preventDefault();
          onOpenAlternatives(focused);
          setOpen(false);
          setQuery("");
          return;
        }
      }
      // Left Arrow → batch picker for the focused result, if it has stock at all
      if (e.key === "ArrowLeft") {
        const focused = results[cursor];
        if (focused) {
          e.preventDefault();
          void openBatchPicker(focused);
          return;
        }
      }
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const raw = query.trim();
      // Barcode precedence: a detected scan (fast key bursts) OR a bare numeric
      // code with no name matches resolves via the exact barcode endpoint rather
      // than guessing from fuzzy results — which could bill the wrong medicine.
      const looksLikeBareCode = /^\d{6,}$/.test(raw) && results.length === 0;
      if ((isBarcodeRef.current && raw.length >= 4) || looksLikeBareCode) {
        void handleBarcodeScan(raw);
        return;
      }
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
            medicineName={pickerState.med.name}
            batches={pickerState.batches}
            lifa={lifa}
            onSelect={(batch) => {
              // The picker shows the engine's order; picking anything but the top
              // row is a deliberate pharmacist override.
              addBatch(batch, pickerState.med, batch.id === pickerState.batches[0]?.id);
              setPickerState(null);
            }}
            onClose={() => setPickerState(null)}
          />
        )}
        {classifyTarget && (
          <ClassifyModal
            target={classifyTarget}
            onClose={() => setClassifyTarget(null)}
            onSaved={() => setClassifyTarget(null)}
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
            placeholder="Search by name, generic, composition, or manufacturer — or scan a barcode"
            className="flex-1 text-[15px] text-slate-700 placeholder-blue-400/70 bg-transparent focus:outline-none"
          />

          {isBarcode && (
            <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-wide flex-shrink-0 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full animate-fade-in">
              Barcode
            </span>
          )}

          {/* Visible scan toggle — always shown so staff know scanning exists */}
          <button
            type="button"
            onClick={() => setScanMode((v) => !v)}
            title="Scan a product barcode"
            className={cn(
              "flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold flex-shrink-0 border transition-colors",
              scanMode
                ? "bg-emerald-600 border-emerald-600 text-white"
                : "bg-white border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700",
            )}
          >
            <ScanBarcode className="w-3.5 h-3.5" />
            {scanMode ? "Close Scanner" : "Scan Barcode"}
          </button>
        </div>

        {/* ── Dedicated scan box (visible affordance, mirrors GRN) ─────── */}
        {scanMode && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border-t border-emerald-100">
            <ScanBarcode className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <div className="flex-1">
              <BarcodeInput onScan={handleBarcodeScan} loading={addingId === "barcode"} autoFocus placeholder="Scan or type barcode, then Enter…" />
            </div>
            <span className="text-[11px] text-emerald-600 font-medium whitespace-nowrap hidden sm:block">Scan to add to bill</span>
          </div>
        )}

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
              className="absolute z-50 left-0 right-0 top-full bg-white border border-slate-200 rounded-xl shadow-card-lg overflow-hidden max-h-52 overflow-y-auto"
            >
              {loading && results.length === 0
                ? [0, 1, 2].map((i) => <SkeletonResult key={i} />)
                : results.map((med, i) => {
                    const stock = stockLabel(med);
                    const price = fmtPrice(med.price);
                    return (
                    <li
                      key={med.id}
                      onMouseEnter={() => { setCursor(i); prefetchBatches(med); }}
                      onMouseDown={() => selectMedicine(med)}
                      style={{ animationDelay: `${i * 20}ms`, animationFillMode: "both" }}
                      className={cn(
                        "flex items-center gap-2.5 px-3.5 py-2 cursor-pointer border-b border-slate-50 last:border-0 group",
                        "transition-colors duration-75 animate-fade-in",
                        i === cursor ? "bg-blue-100/70" : "hover:bg-blue-50/50",
                        // Out-of-stock catalogue results still rank in (see quickSearch's
                        // in-stock-first partition) and are still selectable — just visually
                        // deprioritized so a pharmacist can tell at a glance why it's last.
                        stock && med.inStock === false && "opacity-60"
                      )}
                    >
                      <div className={cn(
                        "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0",
                        i === cursor ? "bg-blue-100" : "bg-blue-50 group-hover:bg-blue-100"
                      )}>
                        <Pill className="w-3.5 h-3.5 text-blue-500" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="text-[14px] font-semibold text-slate-800 truncate">{med.name}</p>
                          {med.isLocal ? (
                            <span
                              title="Not yet in the shared medicine catalogue — this pharmacy's own"
                              className="pill bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wide flex-shrink-0"
                            >
                              Local
                            </span>
                          ) : (
                            <ProductTag value={med.category} kind="category" size="xs" className="flex-shrink-0" />
                          )}
                          {canClassify && !med.category && !med.isLocal && (
                            <button
                              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setClassifyTarget(med); }}
                              title="Set category / packaging"
                              className="flex-shrink-0 inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-500 hover:text-blue-700 border border-dashed border-blue-200 hover:border-blue-400 rounded-full px-1.5 py-0.5 transition-colors"
                            >
                              <Tag className="w-2.5 h-2.5" /> Tag
                            </button>
                          )}
                        </div>
                        <p className="text-[12px] text-slate-400 truncate">
                          {[
                            med.genericName,
                            med.manufacturer,
                            med.form && med.strength ? `${med.form} · ${med.strength}` : med.form,
                          ].filter(Boolean).join(" · ")}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0">
                        {med.packSize && (
                          <span className="pill bg-slate-100 text-slate-500 text-[11px]">{med.packSize}</span>
                        )}
                        {/* One pill for stock + price, not two — halves how many badges this
                            row needs to fit, which is what was pushing rows onto a second
                            line and inflating the dropdown's real height past its cap. */}
                        {stock && (
                          <span
                            title={stock.title}
                            className={cn(
                              "pill text-[10px] font-bold whitespace-nowrap",
                              med.inStock ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"
                            )}
                          >
                            {stock.text}{price && med.inStock ? ` · ${price}` : ""}
                          </span>
                        )}
                        {/* Same badge CartTable shows once this is in the cart (see its "LOOSE OK"
                            pill) — surfaced here too so a cashier can tell before adding it, not
                            after, which is the moment that actually decides whether to search
                            for a smaller pack size at all. */}
                        {med.allowLooseSale && (
                          <span className="pill bg-amber-100 text-amber-700 text-[10px] font-bold">LOOSE OK</span>
                        )}
                        <span className="pill bg-blue-100 text-blue-600 text-[12px]">GST {med.gstRate}%</span>
                        {i === cursor && (
                          <span className="pill bg-emerald-100 text-emerald-600 uppercase tracking-wide">↵</span>
                        )}

                        {/* Alternatives — shown when alternatives confirmed, or medicine has a genericName.
                            Never for a local medicine: it has no global medicineId to look alternatives up by. */}
                        {!med.isLocal && (med.hasAlternatives || med.genericName) && (
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
                    );
                  })}
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
              <p className="text-[11px] text-slate-400 mt-1">Try the generic name, composition, manufacturer, or barcode</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
