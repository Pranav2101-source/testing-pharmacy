import { useState, useEffect } from "react";
import { FileX, RefreshCw, AlertTriangle, Eye, Building2 } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { istRangeParams } from "@pharmacy/utils";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { queryKeys } from "@/lib/queryKeys";
import { TableSkeletonRows } from "@/components/Skeleton";
import type { GRN, Supplier } from "../types";
import { fmtDate, currency, isOverdue, daysUntil } from "../utils";
import { FilterBar } from "../components/FilterBar";
import { Pagination } from "../components/Pagination";
import { EmptyState } from "../components/EmptyState";
import { GRNViewModal } from "../modals/GRNViewModal";

export function PurchaseTab({ suppliers, overdueCount = 0, focusOverdueNonce = 0 }: {
  suppliers: Supplier[];
  /** Count of bills with overdue payment (from the shared purchase summary). */
  overdueCount?: number;
  /** Bumped by the parent when the Purchase-tab overdue badge is clicked. */
  focusOverdueNonce?: number;
}) {
  const [viewGrnId, setViewGrnId] = useState<string | null>(null);
  const [page, setPage]           = useState(1);
  const [search, setSearch]       = useState("");
  const [supplierId, setSupp]     = useState("");
  const [dateFrom, setFrom]       = useState("");
  const [dateTo, setTo]           = useState("");
  const [overdueOnly, setOverdue] = useState(false);

  const dSearch = useDebounce(search, 350);

  // Parent bumps focusOverdueNonce when the red overdue badge is clicked — drop
  // every other filter and show only the overdue-payment bills.
  useEffect(() => {
    if (!focusOverdueNonce) return;
    setOverdue(true);
    setSearch(""); setSupp(""); setFrom(""); setTo("");
    setPage(1);
  }, [focusOverdueNonce]);

  const hasFilter = Boolean(dSearch || supplierId || dateFrom || dateTo || overdueOnly);
  function clearFilters() {
    setSearch(""); setSupp(""); setFrom(""); setTo(""); setOverdue(false); setPage(1);
  }

  const { data, isPending, isFetching, refetch } = useQuery({
    queryKey: queryKeys.purchases.grn({ page, search: dSearch, supplierId, dateFrom, dateTo, overdueOnly, status: "CONFIRMED" }),
    queryFn: async () => {
      const p: Record<string, any> = { page, limit: 20, status: "CONFIRMED" };
      if (dSearch)     p.search     = dSearch;
      if (supplierId)  p.supplierId = supplierId;
      Object.assign(p, istRangeParams(dateFrom, dateTo));
      if (overdueOnly) p.overdue    = true;
      const { data } = await api.get("/purchases/grn", { params: p });
      return data.data as { items: GRN[]; total: number };
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const grns    = data?.items ?? [];
  const total   = data?.total ?? 0;
  const loading = isPending;

  return (
    <div className="flex flex-col h-full">
      <FilterBar search={search} onSearch={(v) => { setSearch(v); setPage(1); }}
        supplierId={supplierId} onSupplier={(v) => { setSupp(v); setPage(1); }} suppliers={suppliers}
        dateFrom={dateFrom} dateTo={dateTo} onDateFrom={(v) => { setFrom(v); setPage(1); }} onDateTo={(v) => { setTo(v); setPage(1); }}
        statusValue={overdueOnly ? "overdue" : ""}
        onStatus={(v) => { setOverdue(v === "overdue"); setPage(1); }}
        statusOptions={[{ value: "overdue", label: "Overdue Payment" }]}
        rightSlot={
          <button onClick={() => refetch()} className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:border-slate-300 shadow-card transition-all">
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
          </button>
        }
      />

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-slate-50/90 backdrop-blur-sm z-10 shadow-[0_1px_0_0_#e2e8f0]">
            <tr>
              {["Sr No.","GRN No.","Invoice No.","Entry Date","Bill Date","Distributor","Items","Bill Amt ₹","GST ₹","Payment Due",""].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeletonRows columns={11} widths={["w-6","w-20","w-16","w-16","w-16","w-28","w-8","w-16","w-12","w-20","w-6"]} />
            ) : grns.length === 0 ? (
              <tr><td colSpan={11}>
                {hasFilter ? (
                  <EmptyState icon={FileX}
                    title="No purchase invoices match these filters"
                    desc={overdueCount > 0 && !overdueOnly
                      ? `${overdueCount} bill${overdueCount === 1 ? " has" : "s have"} an overdue payment.`
                      : "Try widening the date range or clearing the filters."}
                    action={overdueCount > 0 && !overdueOnly
                      ? `View ${overdueCount} overdue bill${overdueCount === 1 ? "" : "s"}`
                      : "Clear filters"}
                    onAction={overdueCount > 0 && !overdueOnly
                      ? () => { clearFilters(); setOverdue(true); }
                      : clearFilters} />
                ) : (
                  <EmptyState icon={FileX}
                    title="No purchase invoices found"
                    desc={overdueCount > 0
                      ? `${overdueCount} bill${overdueCount === 1 ? " has" : "s have"} an overdue payment.`
                      : "Confirmed GRNs will appear here"}
                    action={overdueCount > 0 ? `View ${overdueCount} overdue bill${overdueCount === 1 ? "" : "s"}` : undefined}
                    onAction={overdueCount > 0 ? () => setOverdue(true) : undefined} />
                )}
              </td></tr>
            ) : grns.map((grn, i) => {
              const overdue     = isOverdue(grn.paymentDueDate);
              const daysLeft    = daysUntil(grn.paymentDueDate);
              return (
                <tr key={grn.id} className={cn(
                  "border-b border-slate-100 hover:bg-blue-50/30 hover:shadow-[inset_3px_0_0_0_#2563eb] transition-all group",
                  overdue ? "bg-red-50/40" : i % 2 === 1 ? "bg-slate-50/40" : "bg-white",
                )}>
                  <td className="px-4 py-3 text-[12px] text-slate-400 tabular-nums">{(page - 1) * 20 + i + 1}</td>
                  <td className="px-4 py-3 text-[13px] font-bold text-emerald-700 tabular-nums">{grn.grnNumber}</td>
                  <td className="px-4 py-3 text-[12px] text-slate-600">{grn.supplierInvoiceNo ?? "—"}</td>
                  <td className="px-4 py-3 text-[12px] text-slate-500">{fmtDate(grn.createdAt)}</td>
                  <td className="px-4 py-3 text-[12px] text-slate-500">{fmtDate(grn.confirmedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-3 h-3 text-slate-400" />
                      </div>
                      <span className="text-[13px] font-semibold text-slate-800 truncate">{grn.supplier.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{grn.itemCount ?? grn.items?.length ?? 0}</td>
                  <td className="px-4 py-3 text-[13px] font-bold text-slate-900 tabular-nums">{currency(grn.totalAmount)}</td>
                  <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{currency(grn.totalGst)}</td>
                  <td className="px-4 py-3">
                    {grn.paymentDueDate ? (
                      <div className={cn("text-[11px] font-semibold", overdue ? "text-red-600" : daysLeft !== null && daysLeft <= 7 ? "text-amber-600" : "text-slate-500")}>
                        {overdue ? <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Overdue {fmtDate(grn.paymentDueDate)}</span>
                          : <span>{fmtDate(grn.paymentDueDate)}{daysLeft !== null && <span className="text-slate-400 font-normal ml-1">({daysLeft}d)</span>}</span>}
                      </div>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setViewGrnId(grn.id)}
                      title="View GRN details"
                      className="w-7 h-7 rounded-lg hover:bg-blue-100 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:scale-110 active:scale-95 transition-all"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={Math.ceil(total / 20) || 1} total={total} limit={20} onChange={setPage} />

      <AnimatePresence>
        {viewGrnId && (
          <GRNViewModal grnId={viewGrnId} onClose={() => setViewGrnId(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
