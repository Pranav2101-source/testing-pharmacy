import { useState, useEffect } from "react";
import { Loader2, RefreshCw, Plus, RotateCcw, Check, X, Eye, Building2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/queryKeys";
import { TableSkeletonRows } from "@/components/Skeleton";
import type { SupplierReturn, Supplier } from "../types";
import { SR_STATUS } from "../types";
import { fmtDate, currency } from "../utils";
import { Pagination } from "../components/Pagination";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import { ActionBtn } from "../modals/shared";
import { CreateReturnModal } from "../modals/CreateReturnModal";

// ─── Detail modal types ───────────────────────────────────────────────────────

type ReturnDetail = {
  id: string;
  returnNumber: string;
  debitNoteNo: string | null;
  status: string;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGst: number;
  totalAmount: number;
  notes: string | null;
  createdAt: string;
  supplier: { name: string; gstin: string | null };
  items: {
    id: string;
    medicineName: string;
    batchNumber: string;
    quantity: number;
    purchaseRate: number;
    gstRate: number;
    taxableAmount: number;
    cgst: number;
    sgst: number;
    igst: number;
    amount: number;       // DB field name is `amount`, not `totalAmount`
    reason: string;
  }[];
};

// ─── Debit Note Detail Modal ──────────────────────────────────────────────────

function ReturnDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [data,    setData]    = useState<ReturnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    api.get(`/supplier-returns/${id}`)
      .then(({ data }) => setData(data.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }} transition={{ duration: 0.16 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">Debit Note / Return Detail</h2>
            {data && <p className="text-[12px] text-slate-400 mt-0.5">{data.returnNumber} · {data.supplier.name}</p>}
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
            </div>
          ) : error || !data ? (
            <p className="text-center py-16 text-slate-400 text-[13px]">Failed to load return details.</p>
          ) : (
            <>
              {/* Meta row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Debit Note No.</p>
                  <p className="text-[13px] font-semibold text-slate-800 mt-0.5">{data.debitNoteNo ?? "—"}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Date</p>
                  <p className="text-[13px] font-semibold text-slate-800 mt-0.5">{fmtDate(data.createdAt)}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Status</p>
                  <div className="mt-1"><StatusBadge status={data.status} cfg={SR_STATUS} /></div>
                </div>
              </div>

              {/* GSTIN */}
              {data.supplier.gstin && (
                <p className="text-[12px] text-slate-500">Supplier GSTIN: <span className="font-mono font-semibold text-slate-700">{data.supplier.gstin}</span></p>
              )}

              {/* Line items */}
              <div>
                <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-2">Items</p>
                <table className="w-full text-[12px] border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200">
                      {["Medicine","Batch","Qty","Rate","GST%","Taxable","CGST","SGST","IGST","Total"].map((h) => (
                        <th key={h} className="px-2 py-2 text-left font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((item) => (
                      <tr key={item.id} className="border-b border-slate-100">
                        <td className="px-2 py-2 font-medium text-slate-800">{item.medicineName}</td>
                        <td className="px-2 py-2 font-mono text-slate-500">{item.batchNumber}</td>
                        <td className="px-2 py-2 tabular-nums text-slate-700">{item.quantity}</td>
                        <td className="px-2 py-2 tabular-nums text-slate-700">{currency(item.purchaseRate)}</td>
                        <td className="px-2 py-2 tabular-nums text-slate-500">{item.gstRate}%</td>
                        <td className="px-2 py-2 tabular-nums text-slate-700">{currency(item.taxableAmount)}</td>
                        <td className="px-2 py-2 tabular-nums text-slate-600">{currency(item.cgst)}</td>
                        <td className="px-2 py-2 tabular-nums text-slate-600">{currency(item.sgst)}</td>
                        <td className="px-2 py-2 tabular-nums text-slate-600">{currency(item.igst)}</td>
                        <td className="px-2 py-2 tabular-nums font-semibold text-slate-800">{currency(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* GST summary */}
              <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                <p className="text-[11px] font-bold text-red-400 uppercase tracking-wide mb-3">GST Summary</p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-[13px]">
                  <div className="flex justify-between"><span className="text-slate-500">Taxable Amount</span><span className="font-semibold tabular-nums">{currency(data.taxableAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">CGST</span><span className="font-semibold tabular-nums">{currency(data.cgst)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">SGST</span><span className="font-semibold tabular-nums">{currency(data.sgst)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">IGST</span><span className="font-semibold tabular-nums">{currency(data.igst)}</span></div>
                  <div className="flex justify-between col-span-2 pt-2 border-t border-red-100">
                    <span className="font-bold text-slate-700">Total Return Value</span>
                    <span className="font-black text-red-700 text-[15px] tabular-nums">{currency(data.totalAmount)}</span>
                  </div>
                </div>
              </div>

              {data.notes && (
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-[12px] text-slate-600"><span className="font-semibold">Notes:</span> {data.notes}</p>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ─── Returns Tab ──────────────────────────────────────────────────────────────

export function ReturnsTab({ suppliers }: { suppliers: Supplier[] }) {
  const [page, setPage]         = useState(1);
  const [supplierId, setSupp]   = useState("");
  const [status, setStatus]     = useState("");
  const [showCreate, setShow]   = useState(false);
  const [actionId, setAction]   = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isPending, isFetching, refetch } = useQuery({
    queryKey: queryKeys.purchases.returns({ page, supplierId, status }),
    queryFn: async () => {
      const p: Record<string, any> = { page, limit: 20 };
      if (supplierId) p.supplierId = supplierId;
      if (status)     p.status     = status;
      const { data } = await api.get("/supplier-returns", { params: p });
      return data.data as { items: SupplierReturn[]; total: number };
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const returns = data?.items ?? [];
  const total   = data?.total ?? 0;
  const loading = isPending;

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["purchases", "returns"] });
  }

  async function confirm(id: string) {
    if (!window.confirm("Confirm return? This will deduct inventory stock.")) return;
    setAction(id);
    try { await api.patch(`/supplier-returns/${id}/confirm`); invalidate(); }
    catch (e: any) { alert(e?.response?.data?.error ?? "Failed"); } finally { setAction(null); }
  }

  async function cancel(id: string) {
    if (!window.confirm("Cancel this return?")) return;
    setAction(id);
    try { await api.delete(`/supplier-returns/${id}`); invalidate(); }
    catch {/* */} finally { setAction(null); }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-white flex-shrink-0">
        <select value={supplierId} onChange={(e) => { setSupp(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded-lg bg-slate-50/60 h-8 px-2.5 text-[12px] text-slate-600 focus:outline-none focus:bg-white focus:border-red-300 min-w-[160px] transition-colors">
          <option value="">All Distributors</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded-lg bg-slate-50/60 h-8 px-2.5 text-[12px] text-slate-600 focus:outline-none focus:bg-white focus:border-red-300 min-w-[110px] transition-colors">
          <option value="">All Status</option>
          {Object.entries(SR_STATUS).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => refetch()} className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:border-slate-300 shadow-card transition-all">
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
          </button>
          <button onClick={() => setShow(true)}
            className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 active:scale-[0.98] text-white text-[12px] font-semibold h-8 px-3 rounded-lg transition-all shadow-sm shadow-red-200">
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />New Return
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-slate-50/90 backdrop-blur-sm z-10 shadow-[0_1px_0_0_#e2e8f0]">
            <tr>
              {["Sr No.","Return No.","Distributor","Debit Note No.","Status","Items","Return Value ₹","Date","Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeletonRows columns={9} widths={["w-6","w-20","w-28","w-16","w-14","w-8","w-16","w-16","w-20"]} />
            ) : returns.length === 0 ? (
              <tr><td colSpan={9}>
                <EmptyState icon={RotateCcw} title="No supplier returns yet"
                  desc="Track damaged, expired, or incorrect goods returned to distributors" />
              </td></tr>
            ) : returns.map((sr, i) => (
              <tr key={sr.id} className={cn(
                "border-b border-slate-100 hover:bg-red-50/30 hover:shadow-[inset_3px_0_0_0_#ef4444] transition-all group",
                i % 2 === 1 ? "bg-slate-50/40" : "bg-white",
              )}>
                <td className="px-4 py-3 text-[12px] text-slate-400 tabular-nums">{(page - 1) * 20 + i + 1}</td>
                <td className="px-4 py-3 text-[13px] font-bold text-red-600 tabular-nums">{sr.returnNumber}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-3 h-3 text-slate-400" />
                    </div>
                    <span className="text-[13px] font-semibold text-slate-800 truncate">{sr.supplier.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{sr.debitNoteNo ?? "—"}</td>
                <td className="px-4 py-3"><StatusBadge status={sr.status} cfg={SR_STATUS} /></td>
                <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{sr.itemCount}</td>
                <td className="px-4 py-3 text-[13px] font-bold text-slate-900 tabular-nums">{currency(sr.totalAmount)}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{fmtDate(sr.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <ActionBtn onClick={() => setDetailId(sr.id)} disabled={false}
                      icon={Eye} label="View"
                      cls="text-slate-600 border-slate-200 hover:bg-slate-50" />
                    {sr.status === "DRAFT" && (
                      <>
                        <ActionBtn onClick={() => confirm(sr.id)} disabled={actionId === sr.id}
                          icon={actionId === sr.id ? Loader2 : Check} label="Confirm"
                          cls="text-blue-600 border-blue-200 hover:bg-blue-50" />
                        <ActionBtn onClick={() => cancel(sr.id)} disabled={actionId === sr.id}
                          icon={X} label="Cancel" cls="text-red-500 border-red-100 hover:bg-red-50" />
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={Math.ceil(total / 20) || 1} total={total} limit={20} onChange={setPage} />

      <AnimatePresence>
        {showCreate && <CreateReturnModal suppliers={suppliers} onClose={() => setShow(false)} onDone={() => { setShow(false); invalidate(); }} />}
        {detailId  && <ReturnDetailModal id={detailId} onClose={() => setDetailId(null)} />}
      </AnimatePresence>
    </div>
  );
}
