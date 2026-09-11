import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight, PauseCircle, XCircle, RotateCcw, Search, Loader2, Check, Zap,
} from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { sortAlternatives } from "@/components/billing/AlternativesDrawer";
import {
  buildCartItem, buildAlternativeCartItem,
  type ItemResolution, type FefoBatch,
} from "@/lib/prescriptionToCart";
import type { CartItem } from "@/components/billing/useBillingStore";
import type { AlternativeResult } from "@pharmacy/types";
import { useMedicineCatalogSearch, type MedicineHit } from "@/lib/useMedicineCatalogSearch";
import { formatMeasuredAmount } from "@/lib/measuredUnits";
import type { PackSizeConfidence } from "@/lib/packSizeConfidence";
import { saleUnitModel, pluraliseUnit } from "@pharmacy/utils";

export type StockInfo = {
  availableQty: number;
  stockStatus: "in_stock" | "low_stock" | "out_of_stock";
  /** Resolved base unit ("TABLET" | "CAPSULE" | "ML" | "GM" | "EACH") — names `availableQty`. */
  baseUnit?: string | null;
  /** The catalogue's packaging word ("Strip", "Bottle") — see `CartItem.unit`. */
  unit?: string | null;
  /**
   * For a MEASURED line: the mL/g in one sealed pack, resolved LIVE from the catalogue
   * (this pharmacy's override first). Null when countable or unclassified.
   *
   * Live, not from the line's stored `roundedPackCount`: a line resolved before its medicine
   * was classified carries no measured metadata, while billing reads today's catalogue — so
   * only the live value describes the conversion that is actually about to happen.
   */
  effectivePackSize?: number | null;
  /** Sealed packs the dispensing engine will allocate for the quantity still owed. */
  projectedPackCount?: number | null;
  /** Set when `projectedPackCount` is an implausible course for this dosage form. */
  packCountWarning?: string | null;
  /**
   * How far `effectivePackSize` — the number this pharmacy bills by — may be trusted:
   * "VERIFIED" | "UNVERIFIED" | "DISPUTED", or null/absent when the medicine is countable or
   * unclassified. A pharmacist here confirming that exact number makes it VERIFIED for this
   * pharmacy without touching the shared catalogue.
   *
   * Distinct from `packCountWarning` above and not a substitute for it: that fires when the
   * arithmetic looks wrong, this says whether anyone ever checked the number the arithmetic
   * divides by. A halved bottle volume produces a perfectly plausible answer and no warning.
   */
  packSizeConfidence?: PackSizeConfidence | null;
};

/** For a measured (mL/g) line: how to render its piece-count stock as sealed packs. */
export type MeasuredStock = { clinicalUom: string; packSize: number | null };

/**
 * The plural noun for a countable line's piece count — "tablets", "capsules", "units".
 * Resolved through the shared {@link saleUnitModel} so the triage screen names a medicine
 * exactly as the billing cart does; a line whose catalogue record says nothing lands on
 * "units", which is honest, rather than on the tablet-era "strips".
 */
export function pieceNoun(stock: Pick<StockInfo, "baseUnit" | "unit">, count: number): string {
  const model = saleUnitModel({ unit: stock.unit, baseUnit: stock.baseUnit });
  return pluraliseUnit(model.looseUnitLabel, count);
}

/** Same three-colour vocabulary as the billing alternatives drawer, so a pharmacist reads one stock language app-wide. */
function StockDot({ status }: { status: StockInfo["stockStatus"] }) {
  return (
    <span className={cn(
      "w-2 h-2 rounded-full flex-shrink-0",
      status === "in_stock" ? "bg-emerald-500" : status === "low_stock" ? "bg-amber-400" : "bg-red-400",
    )} />
  );
}

function stockLabel(stock: StockInfo, measured?: MeasuredStock): string {
  if (stock.stockStatus === "out_of_stock") return "Out of stock";
  // `availableQty` is a piece count — individual mL/g for a measured line. Render it as whole
  // sealed packs so this reads the same way the cart's "5 in stock" does, not "500". A
  // countable line gets its own noun ("1050 tablets"): a bare number here left a pharmacist
  // guessing whether it meant strips or tablets, and the two differ by the pack multiple.
  const qty = measured
    ? formatMeasuredAmount(stock.availableQty, measured.clinicalUom, measured.packSize)
    : `${stock.availableQty} ${pieceNoun(stock, stock.availableQty)}`;
  if (stock.stockStatus === "low_stock") return `Low stock · ${qty} left`;
  return `In stock · ${qty}`;
}

/**
 * The stock line for one prescribed, catalogue-linked item.
 *
 * <p>Out-of-stock is the only state that gets Replace/Remove/Hold — an in-stock or low-stock
 * line has nothing to resolve, and offering the same three buttons there would just be three
 * more things to read on a line that is already fine. See {@link ItemResolution} for what each
 * decision means once "Continue to Billing" runs.
 */
export default function StockActionPanel({
  medicineId,
  medicineName,
  schedule,
  remaining,
  prescriptionItemId,
  stock,
  stockCheckFailed,
  measured,
  resolution,
  onResolve,
  onClear,
}: {
  medicineId: string;
  medicineName: string;
  schedule: string | null;
  remaining: number;
  prescriptionItemId: string;
  /** Undefined while the stock check is still loading, or once it has given up (see stockCheckFailed). */
  stock: StockInfo | undefined;
  /** Set for a measured (mL/g) line, so its piece-count stock reads as sealed packs. */
  measured?: MeasuredStock;
  /** True once the stock-check request has exhausted its retries and definitively failed. */
  stockCheckFailed: boolean;
  resolution: ItemResolution | undefined;
  onResolve: (r: ItemResolution) => void;
  onClear: () => void;
}) {
  const toast = useToast();
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [usingTop, setUsingTop] = useState(false);

  // Fetched at this level (not just inside the Replace drawer) so a one-click "Use" button can
  // sit next to Replace/Hold/Remove without waiting on that extra click to open it — React
  // Query dedupes this against the identical query the drawer below also runs, so it's not a
  // second network round-trip once the drawer opens too.
  const outOfStock = stock?.stockStatus === "out_of_stock" || (!stock && stockCheckFailed);

  // Debounced, not immediate: a pharmacist who Holds or Removes an out-of-stock line right
  // away (a common, fast decision — no interest in a substitute) never needed this fetch at
  // all. Waiting a beat before firing means that fast path costs zero network calls, while a
  // pharmacist who pauses to actually consider Replace still finds the one-click button ready
  // by the time they look at it.
  const [readyForAltFetch, setReadyForAltFetch] = useState(false);
  useEffect(() => {
    if (!outOfStock || resolution) { setReadyForAltFetch(false); return; }
    const t = setTimeout(() => setReadyForAltFetch(true), 500);
    return () => clearTimeout(t);
  }, [outOfStock, resolution, medicineId]);

  const { data: topAltCandidates } = useQuery({
    queryKey: ["alternatives", medicineId],
    queryFn: async () => {
      const res = await api.get<{ data: AlternativeResult[] }>(`/medicines/${medicineId}/alternatives`);
      return res.data.data;
    },
    enabled: outOfStock && !resolution && readyForAltFetch,
    staleTime: 30_000,
  });
  const topAlt = topAltCandidates
    ? sortAlternatives(topAltCandidates).find((a) => a.stockStatus !== "out_of_stock")
    : undefined;

  function useTopAlternative() {
    if (!topAlt) return;
    setUsingTop(true);
    try {
      const now = new Date();
      const batch = topAlt.batches
        .filter((b) => new Date(b.expiryDate) > now && b.quantity - b.reservedQuantity > 0)
        .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())[0];
      if (!batch) {
        toast.error(`${topAlt.name} has no sellable batch right now`);
        return;
      }
      const cartItem = buildAlternativeCartItem(topAlt, batch, schedule, remaining, prescriptionItemId);
      if (!cartItem) {
        toast.error(`${topAlt.name} has no sellable batch right now`);
        return;
      }
      onResolve({ action: "replace", cartItem });
    } finally {
      setUsingTop(false);
    }
  }

  if (resolution) {
    return (
      <div className="flex items-center gap-2 mt-1.5 rounded-md bg-slate-50 border border-slate-150 px-2.5 py-1.5">
        <span className="text-[11.5px] text-slate-600 flex-1 min-w-0 truncate">
          {resolution.action === "replace" && (
            <>Will use <span className="font-semibold text-slate-800">{resolution.cartItem.medicineName}</span> instead</>
          )}
          {resolution.action === "hold" && "Held — will stay pending on this prescription"}
          {resolution.action === "remove" && "Removed from this bill"}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700"
        >
          <RotateCcw className="w-3 h-3" /> Undo
        </button>
      </div>
    );
  }

  // Still loading, and not (yet) given up — the common, brief case.
  if (!stock && !stockCheckFailed) {
    return (
      <div className="flex items-center gap-1.5 mt-1.5 text-[11.5px] text-slate-400">
        <span className="w-2 h-2 rounded-full bg-slate-300 animate-pulse flex-shrink-0" />
        Checking stock…
      </div>
    );
  }

  if (stock && stock.stockStatus !== "out_of_stock") {
    return (
      <div className="flex items-center gap-1.5 mt-1.5 text-[11.5px]">
        <StockDot status={stock.stockStatus} />
        <span className={stock.stockStatus === "low_stock" ? "text-amber-700 font-medium" : "text-emerald-700 font-medium"}>
          {stockLabel(stock, measured)}
        </span>
      </div>
    );
  }

  // Either confirmed out of stock, or the check failed and nobody actually knows — either way
  // a pharmacist gets the same three ways to move this line forward without waiting on a
  // number that may never arrive. The label is the only thing that tells the two apart.
  const unknown = !stock;
  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn(
          "flex items-center gap-1.5 text-[11.5px] font-medium",
          unknown ? "text-slate-500" : "text-red-700",
        )}>
          <span className={cn("w-2 h-2 rounded-full flex-shrink-0", unknown ? "bg-slate-300" : "bg-red-400")} />
          {unknown ? "Could not check stock" : "Out of stock"}
        </span>
        <div className="flex items-center gap-1 ml-auto">
          {topAlt && (
            <button
              type="button"
              disabled={usingTop}
              onClick={useTopAlternative}
              title={`Use ${topAlt.name} without opening the alternatives list`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
            >
              {usingTop ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
              Use {topAlt.name}
            </button>
          )}
          <button
            type="button"
            onClick={() => setReplaceOpen((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors",
              replaceOpen
                ? "bg-violet-600 text-white border-violet-600"
                : "bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100",
            )}
          >
            <ArrowLeftRight className="w-3 h-3" /> Replace
          </button>
          <button
            type="button"
            onClick={() => onResolve({ action: "hold" })}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          >
            <PauseCircle className="w-3 h-3" /> Hold
          </button>
          <button
            type="button"
            onClick={() => onResolve({ action: "remove" })}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border border-slate-200 bg-white text-slate-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50"
          >
            <XCircle className="w-3 h-3" /> Remove
          </button>
        </div>
      </div>

      {replaceOpen && (
        <InlineAlternativesPanel
          medicineId={medicineId}
          medicineName={medicineName}
          schedule={schedule}
          remaining={remaining}
          prescriptionItemId={prescriptionItemId}
          onUse={(cartItem) => { onResolve({ action: "replace", cartItem }); setReplaceOpen(false); }}
          onCancel={() => setReplaceOpen(false)}
        />
      )}
    </div>
  );
}

// ── Inline alternatives + fallback search ───────────────────────────────────────

function InlineAlternativesPanel({
  medicineId,
  medicineName,
  schedule,
  remaining,
  prescriptionItemId,
  onUse,
  onCancel,
}: {
  medicineId: string;
  medicineName: string;
  schedule: string | null;
  remaining: number;
  prescriptionItemId: string;
  onUse: (cartItem: CartItem) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [searchOpen, setSearchOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [resolving, setResolving] = useState<string | null>(null);

  const { data: alternatives, isLoading, isError } = useQuery({
    queryKey: ["alternatives", medicineId],
    queryFn: async () => {
      const res = await api.get<{ data: AlternativeResult[] }>(`/medicines/${medicineId}/alternatives`);
      return res.data.data;
    },
    staleTime: 30_000,
  });
  const sorted = alternatives ? sortAlternatives(alternatives).slice(0, 3) : [];

  const { data: hits = [], isFetching: searching, isError: searchFailed } = useMedicineCatalogSearch(term, 6, searchOpen);

  function useAlternative(alt: AlternativeResult) {
    const now = new Date();
    const batch = alt.batches
      .filter((b) => new Date(b.expiryDate) > now && b.quantity - b.reservedQuantity > 0)
      .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())[0];
    if (!batch) {
      toast.error(`${alt.name} has no sellable batch right now`);
      return;
    }
    const cartItem = buildAlternativeCartItem(alt, batch, schedule, remaining, prescriptionItemId);
    if (!cartItem) {
      toast.error(`${alt.name} has no sellable batch right now`);
      return;
    }
    onUse(cartItem);
  }

  async function useSearched(hit: MedicineHit) {
    setResolving(hit.id);
    try {
      const { data } = await api.get<{ data: FefoBatch | null }>(
        `/inventory/fefo/${hit.id}`,
        { params: { quantity: remaining } },
      );
      if (!data.data) {
        toast.error(`${hit.name} is also out of stock`);
        return;
      }
      const built = buildCartItem(data.data, schedule, remaining);
      if (!built) {
        toast.error(`${hit.name} is also out of stock`);
        return;
      }
      onUse({ ...built, prescriptionItemId });
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not check that medicine's stock"));
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50/50 p-2.5">
      <p className="text-[10.5px] font-bold text-violet-700 uppercase tracking-wide mb-1.5">
        Alternatives for {medicineName}
      </p>

      {isLoading && (
        <p className="text-[12px] text-slate-500 flex items-center gap-1.5 py-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Looking for matches…
        </p>
      )}
      {isError && <p className="text-[12px] text-red-600 py-1">Could not load alternatives.</p>}
      {!isLoading && !isError && sorted.length === 0 && !searchOpen && (
        <p className="text-[12px] text-slate-500 py-1">
          No same-composition alternatives in your catalogue.
        </p>
      )}

      {!isLoading && sorted.length > 0 && (
        <div className="space-y-1">
          {sorted.map((alt) => {
            const outOfStock = alt.stockStatus === "out_of_stock";
            return (
            <div
              key={alt.id}
              className={cn(
                "flex items-center gap-2 bg-white rounded-md border border-slate-200 px-2.5 py-1.5",
                outOfStock && "opacity-60",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-slate-800 truncate">{alt.name}</p>
                <p className="text-[11px] text-slate-500 truncate">
                  {alt.genericName ? `Same composition${alt.strength ? ` · ${alt.strength}` : ""}` : "Alternative"}
                  {" · "}
                  <span className={outOfStock ? "text-red-600" : alt.stockStatus === "low_stock" ? "text-amber-600" : "text-emerald-600"}>
                    {outOfStock ? "Out of stock" : `${alt.totalStock} in stock`}
                  </span>
                </p>
              </div>
              <button
                type="button"
                disabled={outOfStock}
                onClick={() => useAlternative(alt)}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold",
                  outOfStock
                    ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                    : "bg-violet-600 text-white hover:bg-violet-700",
                )}
              >
                <Check className="w-3 h-3" /> Use
              </button>
            </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={() => setSearchOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 hover:text-violet-900"
        >
          <Search className="w-3 h-3" /> {searchOpen ? "Hide search" : "Search medicine instead"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto text-[11px] font-semibold text-slate-400 hover:text-slate-600"
        >
          Cancel
        </button>
      </div>

      {searchOpen && (
        <div className="mt-2">
          <input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search your catalogue…"
            className="w-full rounded-md border border-slate-200 py-1.5 px-2.5 text-[12.5px] focus:border-violet-400 focus:outline-none"
          />
          <div className="mt-1.5 max-h-32 overflow-y-auto space-y-1">
            {term.trim().length < 2 ? (
              <p className="px-1 py-1 text-[11.5px] text-slate-500">Type at least two letters.</p>
            ) : searching ? (
              <p className="px-1 py-1 text-[11.5px] text-slate-500">Searching…</p>
            ) : searchFailed ? (
              <p className="px-1 py-1 text-[11.5px] text-red-600">Couldn't search — check your connection and try again.</p>
            ) : hits.length === 0 ? (
              <p className="px-1 py-1 text-[11.5px] text-slate-500">Nothing matched.</p>
            ) : (
              hits.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={resolving !== null}
                  onClick={() => useSearched(m)}
                  className="w-full flex items-center justify-between gap-2 rounded-md bg-white border border-slate-200 px-2.5 py-1.5 text-left hover:border-violet-300 disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] text-slate-800">{m.name}</span>
                    {(m.genericName || m.strength) && (
                      <span className="block truncate text-[11px] text-slate-500">
                        {[m.genericName, m.strength, m.form].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                  {resolving === m.id && <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-violet-600" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
