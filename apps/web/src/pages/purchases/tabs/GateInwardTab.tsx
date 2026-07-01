import { useState } from "react";
import { Loader2, RefreshCw, Plus, Check, X, Truck, Building2 } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/queryKeys";
import { TableSkeletonRows } from "@/components/Skeleton";
import type { GRN, Supplier } from "../types";
import { fmtDate, currency } from "../utils";
import { Pagination } from "../components/Pagination";
import { EmptyState } from "../components/EmptyState";
import { ActionBtn } from "../modals/shared";
import { CreateGRNModal } from "../modals/CreateGRNModal";

export function GateInwardTab({ suppliers }: { suppliers: Supplier[] }) {
  const [page, setPage]       = useState(1);
  const [supplierId, setSupp] = useState("");
  const [actionId, setAction] = useState<string | null>(null);
  const [showCreate, setShow] = useState(false);
  const queryClient = useQueryClient();

  const { data, isPending, isFetching, refetch } = useQuery({
    queryKey: queryKeys.purchases.grn({ page, supplierId, status: "DRAFT" }),
    queryFn: async () => {
      const p: Record<string, any> = { page, limit: 20, status: "DRAFT" };
      if (supplierId) p.supplierId = supplierId;
      const { data } = await api.get("/purchases/grn", { params: p });
      return data.data as { items: GRN[]; total: number };
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const grns    = data?.items ?? [];
  const total   = data?.total ?? 0;
  const loading = isPending;

  // Confirming/cancelling a GRN also moves it between Gate Inward (DRAFT) and
  // Purchase (CONFIRMED) tabs, so invalidate the whole /purchases/grn family.
  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["purchases", "grn"] });
  }

  async function confirm(id: string) {
    if (!window.confirm("Confirm this GRN? This will update inventory stock and cannot be undone.")) return;
    setAction(id);
    try { await api.patch(`/purchases/grn/${id}/confirm`); invalidate(); }
    catch (e: any) { alert(e?.response?.data?.error ?? "Failed to confirm GRN"); }
    finally { setAction(null); }
  }

  async function cancel(id: string) {
    if (!window.confirm("Cancel this GRN?")) return;
    setAction(id);
    try { await api.delete(`/purchases/grn/${id}`); invalidate(); }
    catch {/* */} finally { setAction(null); }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-white flex-shrink-0">
        <select value={supplierId} onChange={(e) => { setSupp(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded-lg bg-slate-50/60 h-8 px-2.5 text-[12px] text-slate-600 focus:outline-none focus:bg-white focus:border-amber-300 min-w-[160px] transition-colors">
          <option value="">All Distributors</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => refetch()} className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:border-slate-300 shadow-card transition-all">
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
          </button>
          <button onClick={() => setShow(true)}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white text-[12px] font-semibold h-8 px-3 rounded-lg transition-all shadow-sm shadow-emerald-200">
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />New Gate Inward
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-slate-50/90 backdrop-blur-sm z-10 shadow-[0_1px_0_0_#e2e8f0]">
            <tr>
              {["Sr No.","GRN No.","Supplier Invoice","Against PO","Distributor","Items","Total ₹","Date","Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeletonRows columns={9} widths={["w-6","w-20","w-20","w-16","w-28","w-8","w-16","w-16","w-20"]} />
            ) : grns.length === 0 ? (
              <tr><td colSpan={9}>
                <EmptyState icon={Truck} title="No pending gate inwards"
                  desc="Draft GRNs waiting to be confirmed appear here"
                  action="Create New GRN" onAction={() => setShow(true)} />
              </td></tr>
            ) : grns.map((grn, i) => (
              <tr key={grn.id} className={cn(
                "border-b border-slate-100 hover:bg-amber-50/30 hover:shadow-[inset_3px_0_0_0_#f59e0b] transition-all group",
                i % 2 === 1 ? "bg-slate-50/40" : "bg-white",
              )}>
                <td className="px-4 py-3 text-[12px] text-slate-400 tabular-nums">{(page - 1) * 20 + i + 1}</td>
                <td className="px-4 py-3 text-[13px] font-bold text-amber-700 tabular-nums">{grn.grnNumber}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{grn.supplierInvoiceNo ?? "—"}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{grn.purchaseOrder?.orderNumber ?? "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-3 h-3 text-slate-400" />
                    </div>
                    <span className="text-[13px] font-semibold text-slate-800 truncate">{grn.supplier.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{grn._count.items}</td>
                <td className="px-4 py-3 text-[13px] font-bold text-slate-900 tabular-nums">{currency(grn.totalAmount)}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{fmtDate(grn.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <ActionBtn onClick={() => confirm(grn.id)} disabled={actionId === grn.id}
                      icon={actionId === grn.id ? Loader2 : Check} label="Confirm"
                      cls="text-emerald-600 border-emerald-200 hover:bg-emerald-50" />
                    <ActionBtn onClick={() => cancel(grn.id)} disabled={actionId === grn.id}
                      icon={X} label="Cancel" cls="text-red-500 border-red-100 hover:bg-red-50" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={Math.ceil(total / 20) || 1} total={total} limit={20} onChange={setPage} />

      <AnimatePresence>
        {showCreate && <CreateGRNModal suppliers={suppliers} onClose={() => setShow(false)} onDone={() => { setShow(false); invalidate(); }} />}
      </AnimatePresence>
    </div>
  );
}
