import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Loader2, FileX, AlertCircle, ArrowUp, ArrowDown } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { baseUnitShort } from "@pharmacy/utils";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/queryKeys";
import { REFERENCE_TYPE_LABEL, MOVEMENT_TYPE_CFG } from "../types";
import type { LedgerEntry } from "../types";

/** Amber unit suffix for a loose (cut-strip) row, whose numbers are in pieces not packs. */
function UnitTag({ baseUnit }: { baseUnit: string | null }) {
  if (!baseUnit) return null;
  return <span className="ml-1 text-[10px] font-semibold text-amber-600">{baseUnitShort(baseUnit)}</span>;
}

/** A loose row counts pieces, not packs — tint it so the Qty / Before→After columns
 *  don't read as one broken running total against the pack rows above and below. */
const looseRowTint = (baseUnit: string | null) => (baseUnit ? "bg-amber-50/50" : "");
const looseBeforeAfterTitle = (baseUnit: string | null) =>
  baseUnit ? `Counted in ${baseUnitShort(baseUnit)} (individual pieces), not whole packs` : undefined;

export function LedgerTab() {
  const [page,      setPage]      = useState(1);
  const [direction, setDirection] = useState<"" | "IN" | "OUT">("");
  const [type,      setType]      = useState("");

  // Backend returns { items, total } (the app-wide list shape); each entry nests
  // inventory.medicine + user, which the table below reads directly.
  type LedgerResponse = { items: LedgerEntry[]; total: number };
  const queryParams = { page, direction, type };
  const { data, isFetching: loading, error: queryError, refetch: load } = useQuery({
    queryKey:        queryKeys.inventory.ledger(queryParams),
    queryFn:         () => {
      const params: Record<string, string | number> = { page, limit: 50 };
      if (direction) params.direction = direction;
      if (type)      params.type      = type;
      return api.get("/inventory/ledger", { params }).then((r) => r.data.data as LedgerResponse);
    },
    staleTime:       30_000,
    placeholderData: keepPreviousData,
  });

  const entries    = data?.items ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50) || 1;
  const loadError  = queryError ? getErrorMessage(queryError, "Couldn't load the ledger. Check your connection and try again.") : null;

  const showSkeleton = loading && entries.length === 0 && !loadError;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-[#f7f9fc] flex-shrink-0">
        <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}
          className="border border-slate-200 bg-white rounded-md h-[30px] px-2.5 text-[12px] text-slate-600 focus:outline-none shadow-sm">
          <option value="">All types</option>
          {["SALE","RETURN","PURCHASE","ADJUSTMENT","OPENING","DAMAGE","EXPIRY_REMOVAL"].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        {(["", "IN", "OUT"] as const).map((d) => (
          <button key={d} onClick={() => { setDirection(d); setPage(1); }}
            className={cn("h-[30px] px-3 rounded-md text-[12px] font-semibold border transition-all shadow-sm",
              direction === d ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
            )}>
            {d === "" ? "All" : d === "IN" ? "↑ IN" : "↓ OUT"}
          </button>
        ))}
        <span className="text-[12px] text-slate-400 ml-auto flex items-center gap-1.5">
          {loading && entries.length > 0 && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
          {total} movements
        </span>
      </div>

      <div className={cn("flex-1 overflow-auto min-h-0 transition-opacity duration-150", loading && entries.length > 0 && "opacity-60")}>
        <table className="w-full border-collapse hidden md:table">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-slate-200">
              {["Date/Time","Medicine","Batch","Type","Dir","Qty","Before→After","Reference","User"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold text-blue-600 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {showSkeleton ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="px-4 py-3"><div className="skeleton h-3 w-14 rounded mb-1" /><div className="skeleton h-2.5 w-10 rounded" /></td>
                  <td className="px-4 py-3"><div className="skeleton h-3.5 w-28 rounded mb-1" /><div className="skeleton h-2.5 w-20 rounded" /></td>
                  <td className="px-4 py-3"><div className="skeleton h-3 w-16 rounded" /></td>
                  <td className="px-4 py-3"><div className="skeleton h-3 w-20 rounded" /></td>
                  <td className="px-4 py-3"><div className="skeleton h-3 w-10 rounded" /></td>
                  <td className="px-4 py-3"><div className="skeleton h-3.5 w-8 rounded" /></td>
                  <td className="px-4 py-3"><div className="skeleton h-3 w-16 rounded" /></td>
                  <td className="px-4 py-3"><div className="skeleton h-3 w-20 rounded" /></td>
                  <td className="px-4 py-3"><div className="skeleton h-3 w-16 rounded" /></td>
                </tr>
              ))
            ) : loadError ? (
              <tr><td colSpan={9} className="py-24 text-center">
                <AlertCircle className="w-8 h-8 text-red-300 mx-auto mb-2" />
                <p className="text-[13px] text-red-500 font-medium mb-2">{loadError}</p>
                <button onClick={() => void load()} className="text-[12px] text-blue-600 hover:underline">Retry</button>
              </td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={9} className="py-24 text-center"><FileX className="w-10 h-10 text-slate-200 mx-auto mb-3" /><p className="text-slate-500 text-[14px] font-medium">No movements yet</p></td></tr>
            ) : entries.map((e) => (
              <tr key={e.id} className={cn("border-b border-slate-100 hover:bg-slate-50/50 transition-colors", looseRowTint(e.baseUnit))}>
                <td className="px-4 py-3 text-[11px] text-slate-500 whitespace-nowrap">
                  {new Date(e.createdAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}<br />
                  <span className="text-slate-400">{new Date(e.createdAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</span>
                </td>
                <td className="px-4 py-3">
                  <p className="text-[13px] font-semibold text-slate-800 max-w-[130px] truncate">{e.inventory?.medicine?.name ?? "—"}</p>
                  {e.inventory?.medicine?.genericName && <p className="text-[10px] text-slate-400 truncate">{e.inventory.medicine.genericName}</p>}
                </td>
                <td className="px-4 py-3 text-[11px] font-mono text-slate-600">{e.inventory?.batchNumber ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className={cn("text-[12px] font-bold", MOVEMENT_TYPE_CFG[e.type] ?? "text-slate-600")}>{e.type}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={cn("inline-flex items-center gap-1 text-[12px] font-bold", e.direction === "IN" ? "text-emerald-600" : "text-red-600")}>
                    {e.direction === "IN" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                    {e.direction}
                  </span>
                </td>
                <td className="px-4 py-3 text-[13px] font-bold tabular-nums text-slate-800">{e.quantity}<UnitTag baseUnit={e.baseUnit} /></td>
                <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums" title={looseBeforeAfterTitle(e.baseUnit)}>{e.quantityBefore} → {e.quantityAfter}<UnitTag baseUnit={e.baseUnit} /></td>
                <td className="px-4 py-3" title={e.notes ?? undefined}>
                  <span className="text-[11px] text-slate-500 font-medium">{e.referenceType ? (REFERENCE_TYPE_LABEL[e.referenceType] ?? e.referenceType) : "—"}</span>
                  {e.notes && (
                    <p className="text-[10px] text-slate-400 max-w-[120px] truncate mt-0.5">{e.notes}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{e.user?.name ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Phone cards */}
        <div className="md:hidden">
          {showSkeleton ? (
            <div className="divide-y divide-slate-100">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="skeleton h-3.5 w-32 rounded" />
                    <div className="skeleton h-3.5 w-10 rounded" />
                  </div>
                  <div className="skeleton h-3 w-44 rounded mb-2" />
                  <div className="flex items-center justify-between">
                    <div className="skeleton h-2.5 w-24 rounded" />
                    <div className="skeleton h-2.5 w-16 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div className="py-24 text-center px-4">
              <AlertCircle className="w-8 h-8 text-red-300 mx-auto mb-2" />
              <p className="text-[13px] text-red-500 font-medium mb-2">{loadError}</p>
              <button onClick={() => void load()} className="text-[12px] text-blue-600 hover:underline">Retry</button>
            </div>
          ) : entries.length === 0 ? (
            <div className="py-24 text-center"><FileX className="w-10 h-10 text-slate-200 mx-auto mb-3" /><p className="text-slate-500 text-[14px] font-medium">No movements yet</p></div>
          ) : (
            <div className="divide-y divide-slate-100">
              {entries.map((e) => (
                <div key={e.id} className={cn("p-4", looseRowTint(e.baseUnit))}>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-slate-800 truncate">{e.inventory?.medicine?.name ?? "—"}</p>
                      {e.inventory?.medicine?.genericName && <p className="text-[11px] text-slate-400 truncate">{e.inventory.medicine.genericName}</p>}
                    </div>
                    <span className={cn("inline-flex items-center gap-1 text-[12px] font-bold flex-shrink-0", e.direction === "IN" ? "text-emerald-600" : "text-red-600")}>
                      {e.direction === "IN" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                      {e.quantity}<UnitTag baseUnit={e.baseUnit} />
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] mb-1.5">
                    <span className={cn("font-bold", MOVEMENT_TYPE_CFG[e.type] ?? "text-slate-600")}>{e.type}</span>
                    <span className="text-slate-300">·</span>
                    <span className="font-mono text-slate-500">{e.inventory?.batchNumber ?? "—"}</span>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-400 tabular-nums">{e.quantityBefore} → {e.quantityAfter}<UnitTag baseUnit={e.baseUnit} /></span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>{e.referenceType ? (REFERENCE_TYPE_LABEL[e.referenceType] ?? e.referenceType) : "—"} · {e.user?.name ?? "—"}</span>
                    <span className="whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}{" "}
                      {new Date(e.createdAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}
                    </span>
                  </div>
                  {e.notes && <p className="text-[11px] text-slate-400 mt-1 truncate">{e.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {!loading && total > 50 && (
        <div className="flex items-center justify-between flex-wrap gap-2 px-5 py-2.5 border-t border-slate-100 bg-slate-50/60 flex-shrink-0">
          <span className="text-[12px] text-slate-500">Showing <span className="font-semibold text-slate-700">{Math.min((page-1)*50+1,total)}–{Math.min(page*50,total)}</span> of <span className="font-semibold text-slate-700">{total}</span></span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage((p) => Math.max(1,p-1))} disabled={page===1} className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] font-medium hover:bg-white disabled:opacity-40">‹ Prev</button>
            <span className="text-[12px] text-slate-500 font-medium px-3 py-1 bg-white border border-slate-200 rounded-lg">{page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages,p+1))} disabled={page===totalPages} className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] font-medium hover:bg-white disabled:opacity-40">Next ›</button>
          </div>
        </div>
      )}
    </div>
  );
}
