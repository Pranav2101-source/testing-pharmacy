import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import {
  Search, Loader2, FileX, AlertCircle, Sparkles, Printer, MapPin, Info, PackagePlus, Pencil, Tag, Scissors,
} from "lucide-react";
import { queryKeys } from "@/lib/queryKeys";
import { BarcodeLabelModal } from "@/components/BarcodeLabelModal";
import { LooseTag } from "@/components/LooseTag";
import {
  LooseSetupModal, candidateFrom, candidateFromMedicine,
  type LooseCandidate, type LooseSetupIntent,
} from "@/components/inventory/LooseSetupModal";
import { PackSizeConfidenceChip } from "@/components/PackSizeConfidenceChip";
import { api, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { getStoredUser } from "@/lib/auth";
import { StatusBadge } from "../components/shared";
import { fmt, daysUntil, packNoun } from "../utils";
import { TableSkeletonRows, ListSkeleton } from "@/components/Skeleton";
import { ProductTag } from "@/lib/product-taxonomy";
import { ClassifyModal, type ClassifyTarget } from "@/components/ClassifyModal";
import { BATCH_STATUS_CFG } from "../types";
import type { BatchStatus, InventoryItem, AlertCounts } from "../types";
import { AddStockModal } from "../modals/AddStockModal";
import { AdjustStockModal } from "../modals/AdjustStockModal";
import { BatchStatusModal } from "../modals/BatchStatusModal";
import { AssignLocationModal } from "../modals/AssignLocationModal";
import { CalibrateModal } from "../modals/CalibrateModal";

/**
 * M2: a `title`-only hint is mouse-only — a <span> isn't focusable and native
 * tooltips generally don't show on keyboard focus anyway, so a keyboard-only
 * pharmacist could never see column explanations like what "+N tablets" means.
 * A real `<button>` (natively focusable) + `aria-label` (screen readers) + a
 * CSS bubble shown on hover OR focus covers mouse, keyboard and screen reader.
 */
function InfoTooltip({ label }: { label: string }) {
  return (
    <span className="relative inline-flex group">
      <button
        type="button"
        aria-label={label}
        className="cursor-help rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        <Info className="w-3 h-3 text-slate-400" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 w-56 -translate-x-1/2 whitespace-normal rounded-md bg-slate-800 px-2.5 py-1.5 text-[11px] font-normal normal-case leading-snug text-white opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

export function BatchesTab({ onCountsLoaded }: { onCountsLoaded: (c: AlertCounts) => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  // A mutation here (adjust/status/location/calibrate) also affects the Ledger
  // (new movement) and Alerts (tier changes) tabs' cached data, so invalidate
  // the whole "inventory" prefix rather than just this tab's own list query.
  const invalidateInventory = () => queryClient.invalidateQueries({ queryKey: ["inventory"] });
  const [page,       setPage]       = useState(1);
  // Seeded from ?search= so a deep link (triage's "Unverified pack size" chip) lands with the
  // medicine already filtered for. Read once, in the initialiser, rather than in an effect —
  // going through state would make the first list request fetch page 1 of everything and then
  // immediately throw it away.
  const [search,     setSearch]     = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [status,     setStatus]     = useState<BatchStatus | "">("");
  const [inStock,    setInStock]    = useState(false);
  const [lowStock,   setLowStock]   = useState(false);
  const [nearExpiry, setNearExpiry] = useState(false);
  const [hasLoose,   setHasLoose]   = useState(false);
  const [statusModal,      setStatusModal]      = useState<InventoryItem | null>(null);
  const [adjustModal,      setAdjustModal]      = useState<InventoryItem | null>(null);
  const [locationModal,    setLocationModal]    = useState<InventoryItem | null>(null);
  const [barcodePrintItem, setBarcodePrintItem] = useState<InventoryItem | null>(null);
  const [showCalibrate,    setShowCalibrate]    = useState(false);
  const [showAddStock,     setShowAddStock]     = useState(false);
  const [classifyTarget,   setClassifyTarget]   = useState<ClassifyTarget | null>(null);
  // undefined = closed; null = open scoped to everything you stock; a candidate = open for just that row.
  const [looseSetup, setLooseSetup] = useState<LooseCandidate | null | undefined>(undefined);
  // Which job that modal is doing — turning loose selling on, or recording that somebody has
  // checked the pack size. Same form, different write; see LooseSetupIntent.
  const [looseIntent, setLooseIntent] = useState<LooseSetupIntent>("enable-loose");

  /**
   * Open the confirm-pack-size dialog for one medicine.
   *
   * Uses `candidateFromMedicine` rather than `candidateFrom`, deliberately: the latter refuses a
   * medicine that already sells loose, which is the right eligibility rule for "enable loose
   * selling" and exactly the wrong one here. An already-loose medicine's pack size is the one
   * doing the most damage if nobody has checked it — it is dividing every per-piece price.
   */
  function openPackSizeVerify(medicine: InventoryItem["medicine"]) {
    setLooseIntent("verify");
    setLooseSetup(candidateFromMedicine(medicine));
  }

  const isOwnerOrManager = ["OWNER", "MANAGER"].includes(getStoredUser()?.role ?? "");

  // Deep-link from the command palette ("Add Stock" action) — open the modal
  // then strip the param so a refresh doesn't reopen it.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("action") === "add-stock" && isOwnerOrManager) {
      setShowAddStock(true);
      const next = new URLSearchParams(searchParams);
      next.delete("action");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce search input before it becomes part of the query key
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), search ? 350 : 0);
    return () => clearTimeout(t);
  }, [search]);

  type ListResponse = { items: InventoryItem[]; total: number; alertCounts: AlertCounts };
  const queryParams = { page, search: debouncedSearch, status, inStock, lowStock, nearExpiry, hasLoose };
  const { data, isFetching: loading, error: queryError, refetch: load } = useQuery({
    queryKey:        queryKeys.inventory.list(queryParams),
    queryFn:         () => {
      const p: Record<string, string | number | boolean> = { page, limit: 20 };
      if (debouncedSearch) p.search     = debouncedSearch;
      if (status)          p.status     = status;
      if (inStock)         p.inStock    = true;
      if (lowStock)        p.lowStock   = true;
      if (nearExpiry)      p.nearExpiry = true;
      if (hasLoose)        p.hasLoose   = true;
      return api.get("/inventory", { params: p }).then((r) => r.data.data as ListResponse);
    },
    staleTime:       30_000,
    placeholderData: keepPreviousData,
  });

  // Propagate alert counts to the parent header badge whenever a fresh response arrives.
  useEffect(() => {
    if (data?.alertCounts) onCountsLoaded(data.alertCounts);
  }, [data?.alertCounts, onCountsLoaded]);

  const items      = data?.items      ?? [];

  /**
   * `?verifyPackSize=<medicineId>` — the triage screen's chip, arriving.
   *
   * Waits for the list rather than firing on mount, because the confirm dialog is built from a
   * batch row (that is where the pack size, base unit and this pharmacy's loose setting all
   * live) and on mount there are no rows yet. `?search=` above is what makes the medicine
   * actually appear; without it a pharmacy with two thousand batches would deep-link to page one
   * of everything and this would never find its target.
   *
   * The param is stripped as soon as it is consumed, so a refresh — or a back-navigation after
   * the pharmacist has moved on to something else — does not reopen the dialog on top of it.
   */
  const verifyPackSizeId = searchParams.get("verifyPackSize");
  useEffect(() => {
    if (!verifyPackSizeId || !isOwnerOrManager || items.length === 0) return;
    const match = items.find((i) => i.medicine.id === verifyPackSizeId);
    const next = new URLSearchParams(searchParams);
    next.delete("verifyPackSize");
    setSearchParams(next, { replace: true });
    if (match) openPackSizeVerify(match.medicine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyPackSizeId, items]);

  const total      = data?.total      ?? 0;
  const totalPages = Math.ceil(total / 20) || 1;
  const error      = queryError ? getErrorMessage(queryError, "Couldn't load inventory. Check your connection and try again.") : null;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-[#f7f9fc] flex-shrink-0 flex-wrap">
        <div className="flex items-center border border-slate-200 rounded-md bg-white overflow-hidden h-[30px] shadow-sm flex-1 max-w-[280px]">
          <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search medicine, batch…"
            className="px-3 bg-transparent text-slate-700 placeholder-slate-400 focus:outline-none w-full h-full text-[13px]" />
          <span className="px-2.5 text-slate-400"><Search className="w-3.5 h-3.5" /></span>
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value as BatchStatus | ""); setPage(1); }}
          className="border border-slate-200 bg-white rounded-md h-[30px] px-2.5 text-[12px] text-slate-600 focus:outline-none shadow-sm">
          <option value="">All statuses</option>
          {(Object.keys(BATCH_STATUS_CFG) as BatchStatus[]).map((s) => (
            <option key={s} value={s}>{BATCH_STATUS_CFG[s].label}</option>
          ))}
        </select>
        {([
          { label: "In Stock",    val: inStock,    set: setInStock,    on: "bg-blue-600 border-blue-600" },
          { label: "Low Stock",   val: lowStock,   set: setLowStock,   on: "bg-blue-600 border-blue-600" },
          { label: "Near Expiry", val: nearExpiry, set: setNearExpiry, on: "bg-blue-600 border-blue-600" },
          { label: "Opened strips", val: hasLoose, set: setHasLoose,   on: "bg-amber-500 border-amber-500" },
        ] as const).map(({ label, val, set, on }) => (
          <button key={label} onClick={() => { set((v) => !v); setPage(1); }}
            aria-pressed={val}
            className={cn("h-[30px] px-3 rounded-md text-[12px] font-semibold border transition-all shadow-sm",
              val ? `${on} text-white` : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
            )}>
            {label}
          </button>
        ))}
        <span className="text-[12px] text-slate-400 ml-auto flex items-center gap-1.5">
          {loading && items.length > 0 && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
          {total} batches
        </span>
        {isOwnerOrManager && (
          <button
            onClick={() => setShowAddStock(true)}
            title="Add newly received stock"
            className="flex items-center gap-1.5 h-[30px] px-3 rounded-md text-[12px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm whitespace-nowrap"
          >
            <PackagePlus className="w-3.5 h-3.5" />
            Add Stock
          </button>
        )}
        {isOwnerOrManager && (
          <button
            onClick={() => setShowCalibrate(true)}
            title="Auto-set minimum stock levels from your sales data"
            className="flex items-center gap-1.5 h-[30px] px-3 rounded-md text-[12px] font-semibold border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors shadow-sm whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Smart Stock Levels
          </button>
        )}
        {isOwnerOrManager && (
          <button
            onClick={() => { setLooseIntent("enable-loose"); setLooseSetup(null); }}
            title="Enable cut-strip (loose) selling for the medicines you stock"
            className="flex items-center gap-1.5 h-[30px] px-3 rounded-md text-[12px] font-semibold border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors shadow-sm whitespace-nowrap"
          >
            <Scissors className="w-3.5 h-3.5" />
            Set up loose selling
          </button>
        )}
      </div>
      {showCalibrate && (
        <CalibrateModal
          onClose={() => setShowCalibrate(false)}
          onApplied={invalidateInventory}
        />
      )}
      {looseSetup !== undefined && (
        <LooseSetupModal
          only={looseSetup ?? undefined}
          intent={looseIntent}
          onClose={() => setLooseSetup(undefined)}
          onDone={(count) => {
            setLooseSetup(undefined);
            invalidateInventory();
            if (count === 0) return;
            toast.success(looseIntent === "verify"
              ? `Pack size confirmed for ${looseSetup?.name ?? "this medicine"}`
              : `Loose selling enabled for ${count} medicine${count === 1 ? "" : "s"}`);
          }}
        />
      )}
      <AnimatePresence>
        {showAddStock && (
          <AddStockModal
            onClose={() => setShowAddStock(false)}
            onDone={() => { setShowAddStock(false); invalidateInventory(); }}
            onToast={(msg, v) => v === "success" ? toast.success(msg) : toast.error(msg)}
          />
        )}
      </AnimatePresence>

      {/* Table (desktop) / Cards (phone) — dim slightly during background re-fetch */}
      <div className={cn("flex-1 overflow-auto min-h-0 transition-opacity duration-150", loading && items.length > 0 && "opacity-60")}>
        <table className="w-full border-collapse hidden md:table">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-slate-200">
              {["Medicine","Batch No.","Expiry"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold text-blue-600 whitespace-nowrap">{h}</th>
              ))}
              <th className="px-4 py-3 text-left text-[12px] font-semibold text-blue-600 whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                  Stock
                  <InfoTooltip label="Counted in the medicine's pack unit — strips, bottles, vials (set it via Categorize). '+N tablets/ml' = loose pieces from an opened pack." />
                </span>
              </th>
              <th className="px-4 py-3 text-left text-[12px] font-semibold text-blue-600 whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                  Reserved
                  <InfoTooltip label="Units held for pending sales / in-progress billing. Automatically released when the bill is finalised or cancelled." />
                </span>
              </th>
              {["MRP","Buy Rate","Location","Status","Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold text-blue-600 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <TableSkeletonRows columns={10} />
            ) : error ? (
              <tr><td colSpan={10} className="py-16 text-center"><AlertCircle className="w-8 h-8 text-red-300 mx-auto mb-2" /><p className="text-red-500 text-[13px]">{error}</p><button onClick={() => void load()} className="mt-2 text-blue-600 text-[12px] hover:underline">Retry</button></td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={10} className="py-24 text-center"><FileX className="w-10 h-10 text-slate-200 mx-auto mb-3" /><p className="text-slate-500 text-[14px] font-medium">No batches found</p></td></tr>
            ) : items.map((item) => {
              const days = daysUntil(item.expiryDate);
              const isNE = days <= 90 && days > 0;
              const isEx = days <= 0;
              return (
                <tr key={item.id} className="border-b border-slate-100 hover:bg-blue-50/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 max-w-[220px]">
                      <p className="text-[13px] font-semibold text-slate-800 truncate">{item.medicine.name}</p>
                      <ProductTag value={item.medicine.category} kind="category" size="xs" className="flex-shrink-0" />
                      {isOwnerOrManager && (
                        item.medicine.category ? (
                          <button
                            onClick={() => setClassifyTarget(item.medicine)}
                            title="Edit category / packaging"
                            aria-label={`Edit category / packaging for ${item.medicine.name}`}
                            className="flex-shrink-0 w-5 h-5 rounded-md hover:bg-blue-100 flex items-center justify-center text-slate-300 hover:text-blue-600 transition-colors"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        ) : (
                          <button
                            onClick={() => setClassifyTarget(item.medicine)}
                            title="Set category / packaging"
                            className="flex-shrink-0 inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-500 hover:text-blue-700 border border-dashed border-blue-200 hover:border-blue-400 rounded-full px-1.5 py-0.5 transition-colors"
                          >
                            <Tag className="w-2.5 h-2.5" /> Categorize
                          </button>
                        )
                      )}
                    </div>
                    {item.medicine.genericName && <p className="text-[11px] text-slate-400 truncate">{item.medicine.genericName}</p>}
                    {item.medicine.brand && <p className="text-[10px] text-blue-400">{item.medicine.brand.name}</p>}
                    {/* This is the screen where the chip can be an ACTION rather than a link —
                        the whole medicine record is already in hand, so the confirm dialog opens
                        in place. Owners/managers only: the endpoint behind it is theirs, and a
                        cashier being shown a button they cannot use is worse than not showing it. */}
                    {isOwnerOrManager && (
                      <PackSizeConfidenceChip
                        confidence={item.medicine.packSizeConfidence}
                        className="mt-1"
                        onVerify={() => openPackSizeVerify(item.medicine)}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-[12px] font-mono text-slate-700">{item.batchNumber}</td>
                  <td className="px-4 py-3">
                    <span className={cn("text-[12px] font-semibold", isEx ? "text-red-600" : isNE ? "text-amber-600" : "text-slate-600")}>
                      {fmt(item.expiryDate)}
                    </span>
                    {isNE && <p className="text-[10px] text-amber-500">{days}d left</p>}
                    {isEx && <p className="text-[10px] text-red-500">Expired</p>}
                  </td>
                  <td className="px-4 py-3">
                    {item.quantity === 0 && (item.looseUnits ?? 0) === 0
                      ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">Out of stock</span>
                      : item.quantity <= item.minimumStock
                        ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                            Low: {item.quantity} {packNoun(item.medicine.unit, item.quantity)}
                          </span>
                        : <>
                            <span className="text-[13px] font-semibold text-slate-800 tabular-nums">{item.quantity}</span>
                            <span className="text-[11px] text-slate-400 ml-1">{packNoun(item.medicine.unit, item.quantity)}</span>
                          </>
                    }
                    <LooseTag units={item.looseUnits} baseUnit={item.medicine.baseUnit} />
                  </td>
                  <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{item.reservedQuantity || "—"}</td>
                  <td className="px-4 py-3 text-[13px] text-slate-700 tabular-nums">₹{item.mrp.toFixed(2)}</td>
                  <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">₹{item.purchaseRate.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    {item.shelf
                      ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md">{item.shelf.rack.code}/{item.shelf.code}</span>
                      : item.location
                        ? <span className="text-[12px] text-slate-500">{item.location}</span>
                        : <span className="text-slate-300 text-[12px]">—</span>}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setAdjustModal(item)}
                        className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 border border-emerald-200 hover:border-emerald-300 bg-emerald-50/50 hover:bg-emerald-50 rounded-md px-2 py-1 transition-colors">
                        Adjust
                      </button>
                      <button onClick={() => setStatusModal(item)}
                        className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-300 bg-blue-50/50 hover:bg-blue-50 rounded-md px-2 py-1 transition-colors">
                        Status
                      </button>
                      {isOwnerOrManager && !item.medicine.allowLooseSale
                        && (item.medicine.schedule ?? "").trim().toUpperCase() !== "X" && (
                        <button onClick={() => { const c = candidateFrom(item.medicine); if (c) { setLooseIntent("enable-loose"); setLooseSetup(c); } }}
                          title="Enable loose (cut-strip) selling"
                          aria-label={`Enable loose (cut-strip) selling for ${item.medicine.name}`}
                          className="p-1 rounded-md hover:bg-amber-100 text-slate-400 hover:text-amber-600 transition-colors">
                          <Scissors className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => setLocationModal(item)} title="Assign location"
                        aria-label={`Assign location for ${item.medicine.name}, batch ${item.batchNumber}`}
                        className="p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-teal-600 transition-colors">
                        <MapPin className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setBarcodePrintItem(item)} title="Print barcode label"
                        aria-label={`Print barcode label for ${item.medicine.name}, batch ${item.batchNumber}`}
                        className="p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Phone cards */}
        <div className="md:hidden">
          {loading && items.length === 0 ? (
            <ListSkeleton rows={6} />
          ) : error ? (
            <div className="py-16 text-center px-4">
              <AlertCircle className="w-8 h-8 text-red-300 mx-auto mb-2" />
              <p className="text-red-500 text-[13px]">{error}</p>
              <button onClick={() => void load()} className="mt-2 text-blue-600 text-[12px] hover:underline">Retry</button>
            </div>
          ) : items.length === 0 ? (
            <div className="py-24 text-center"><FileX className="w-10 h-10 text-slate-200 mx-auto mb-3" /><p className="text-slate-500 text-[14px] font-medium">No batches found</p></div>
          ) : (
            <div className="divide-y divide-slate-100">
              {items.map((item) => {
                const days = daysUntil(item.expiryDate);
                const isNE = days <= 90 && days > 0;
                const isEx = days <= 0;
                return (
                  <div key={item.id} className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="text-[14px] font-semibold text-slate-800 truncate">{item.medicine.name}</p>
                          <ProductTag value={item.medicine.category} kind="category" size="xs" className="flex-shrink-0" />
                          {isOwnerOrManager && !item.medicine.category && (
                            <button
                              onClick={() => setClassifyTarget(item.medicine)}
                              title="Set category / packaging"
                              className="flex-shrink-0 inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-500 border border-dashed border-blue-200 rounded-full px-1.5 py-0.5"
                            >
                              <Tag className="w-2.5 h-2.5" /> Categorize
                            </button>
                          )}
                          {isOwnerOrManager && item.medicine.category && (
                            <button
                              onClick={() => setClassifyTarget(item.medicine)}
                              title="Edit category / packaging"
                              aria-label={`Edit category / packaging for ${item.medicine.name}`}
                              className="flex-shrink-0 w-5 h-5 rounded-md hover:bg-blue-100 flex items-center justify-center text-slate-300 hover:text-blue-600"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        {item.medicine.genericName && <p className="text-[11px] text-slate-400 truncate">{item.medicine.genericName}</p>}
                        {item.medicine.brand && <p className="text-[10px] text-blue-400">{item.medicine.brand.name}</p>}
                      </div>
                      <StatusBadge status={item.status} />
                    </div>

                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px] mb-3">
                      <div><span className="text-slate-400">Batch</span><p className="font-mono text-slate-700">{item.batchNumber}</p></div>
                      <div>
                        <span className="text-slate-400">Expiry</span>
                        <p className={cn("font-semibold", isEx ? "text-red-600" : isNE ? "text-amber-600" : "text-slate-600")}>
                          {fmt(item.expiryDate)}{isNE && ` · ${days}d left`}{isEx && " · Expired"}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-400">Stock</span>
                        <p>
                          {item.quantity === 0 && (item.looseUnits ?? 0) === 0
                            ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">Out of stock</span>
                            : item.quantity <= item.minimumStock
                              ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Low: {item.quantity} {packNoun(item.medicine.unit, item.quantity)}</span>
                              : <><span className="font-semibold text-slate-800 tabular-nums">{item.quantity}</span><span className="text-[11px] text-slate-400 ml-1">{packNoun(item.medicine.unit, item.quantity)}</span></>}
                          <LooseTag units={item.looseUnits} baseUnit={item.medicine.baseUnit} />
                        </p>
                      </div>
                      <div><span className="text-slate-400">Reserved</span><p className="text-slate-600 tabular-nums">{item.reservedQuantity || "—"}</p></div>
                      <div><span className="text-slate-400">MRP</span><p className="text-slate-700 tabular-nums">₹{item.mrp.toFixed(2)}</p></div>
                      <div><span className="text-slate-400">Buy Rate</span><p className="text-slate-500 tabular-nums">₹{item.purchaseRate.toFixed(2)}</p></div>
                    </div>

                    {(item.shelf || item.location) && (
                      <div className="mb-3">
                        {item.shelf
                          ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md">{item.shelf.rack.code}/{item.shelf.code}</span>
                          : <span className="text-[12px] text-slate-500">{item.location}</span>}
                      </div>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => setAdjustModal(item)}
                        className="text-[12px] font-semibold text-emerald-600 border border-emerald-200 bg-emerald-50/50 active:bg-emerald-100 rounded-md px-3 py-1.5">
                        Adjust
                      </button>
                      <button onClick={() => setStatusModal(item)}
                        className="text-[12px] font-semibold text-blue-600 border border-blue-200 bg-blue-50/50 active:bg-blue-100 rounded-md px-3 py-1.5">
                        Status
                      </button>
                      {isOwnerOrManager && !item.medicine.allowLooseSale
                        && (item.medicine.schedule ?? "").trim().toUpperCase() !== "X" && (
                        <button onClick={() => { const c = candidateFrom(item.medicine); if (c) { setLooseIntent("enable-loose"); setLooseSetup(c); } }}
                          title="Enable loose (cut-strip) selling"
                          aria-label={`Enable loose (cut-strip) selling for ${item.medicine.name}`}
                          className="p-2 rounded-md border border-slate-200 text-slate-400 active:bg-amber-100">
                          <Scissors className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => setLocationModal(item)} title="Assign location"
                        aria-label={`Assign location for ${item.medicine.name}, batch ${item.batchNumber}`}
                        className="p-2 rounded-md border border-slate-200 text-slate-400 active:bg-slate-100">
                        <MapPin className="w-4 h-4" />
                      </button>
                      <button onClick={() => setBarcodePrintItem(item)} title="Print barcode label"
                        aria-label={`Print barcode label for ${item.medicine.name}, batch ${item.batchNumber}`}
                        className="p-2 rounded-md border border-slate-200 text-slate-400 active:bg-slate-100">
                        <Printer className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Pagination */}
      {!loading && total > 20 && (
        <div className="flex items-center justify-between flex-wrap gap-2 px-5 py-2.5 border-t border-slate-100 bg-slate-50/60 flex-shrink-0">
          <span className="text-[12px] text-slate-500">Showing <span className="font-semibold text-slate-700">{Math.min((page-1)*20+1,total)}–{Math.min(page*20,total)}</span> of <span className="font-semibold text-slate-700">{total}</span></span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage((p) => Math.max(1,p-1))} disabled={page===1} className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] font-medium hover:bg-white disabled:opacity-40">‹ Prev</button>
            <span className="text-[12px] text-slate-500 font-medium px-3 py-1 bg-white border border-slate-200 rounded-lg">{page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages,p+1))} disabled={page===totalPages} className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] font-medium hover:bg-white disabled:opacity-40">Next ›</button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {classifyTarget && (
          <ClassifyModal
            target={classifyTarget}
            onClose={() => setClassifyTarget(null)}
            onSaved={() => setClassifyTarget(null)}
          />
        )}
        {statusModal && (
          <BatchStatusModal item={statusModal} onClose={() => setStatusModal(null)}
            onDone={() => { setStatusModal(null); invalidateInventory(); }}
            onToast={(msg, v) => v === "success" ? toast.success(msg) : toast.error(msg)} />
        )}
        {adjustModal && (
          <AdjustStockModal item={adjustModal} onClose={() => setAdjustModal(null)}
            onDone={() => { setAdjustModal(null); invalidateInventory(); }}
            onToast={(msg, v) => v === "success" ? toast.success(msg) : toast.error(msg)} />
        )}
        {locationModal && (
          <AssignLocationModal item={locationModal} onClose={() => setLocationModal(null)}
            onDone={() => { setLocationModal(null); invalidateInventory(); }}
            onToast={(msg, v) => v === "success" ? toast.success(msg) : toast.error(msg)} />
        )}
      </AnimatePresence>

      {barcodePrintItem && (
        <BarcodeLabelModal
          item={{
            medicineName: barcodePrintItem.medicine.name,
            genericName:  barcodePrintItem.medicine.genericName,
            batchNumber:  barcodePrintItem.batchNumber,
            expiryDate:   barcodePrintItem.expiryDate,
            mrp:          barcodePrintItem.mrp,
          }}
          onClose={() => setBarcodePrintItem(null)}
        />
      )}
    </div>
  );
}
