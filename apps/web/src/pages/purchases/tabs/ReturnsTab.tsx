import { useState, useCallback, useEffect } from "react";
import { Loader2, RefreshCw, Plus, RotateCcw, Check, X } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { SupplierReturn, Supplier } from "../types";
import { SR_STATUS } from "../types";
import { fmtDate, currency } from "../utils";
import { Pagination } from "../components/Pagination";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import { ActionBtn } from "../modals/shared";
import { CreateReturnModal } from "../modals/CreateReturnModal";

export function ReturnsTab({ suppliers }: { suppliers: Supplier[] }) {
  const [returns, setReturns]   = useState<SupplierReturn[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [loading, setLoading]   = useState(true);
  const [supplierId, setSupp]   = useState("");
  const [status, setStatus]     = useState("");
  const [showCreate, setShow]   = useState(false);
  const [actionId, setAction]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p: Record<string, any> = { page, limit: 20 };
      if (supplierId) p.supplierId = supplierId;
      if (status)     p.status     = status;
      const { data } = await api.get("/supplier-returns", { params: p });
      setReturns(data.data.items); setTotal(data.data.total);
    } catch {/* */} finally { setLoading(false); }
  }, [page, supplierId, status]);

  useEffect(() => { load(); }, [load]);

  async function confirm(id: string) {
    if (!window.confirm("Confirm return? This will deduct inventory stock.")) return;
    setAction(id);
    try { await api.patch(`/supplier-returns/${id}/confirm`); load(); }
    catch (e: any) { alert(e?.response?.data?.error ?? "Failed"); } finally { setAction(null); }
  }

  async function cancel(id: string) {
    if (!window.confirm("Cancel this return?")) return;
    setAction(id);
    try { await api.delete(`/supplier-returns/${id}`); load(); }
    catch {/* */} finally { setAction(null); }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-white flex-shrink-0">
        <select value={supplierId} onChange={(e) => { setSupp(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded-lg bg-white h-8 px-2.5 text-[12px] text-slate-600 focus:outline-none min-w-[160px]">
          <option value="">All Distributors</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded-lg bg-white h-8 px-2.5 text-[12px] text-slate-600 focus:outline-none min-w-[110px]">
          <option value="">All Status</option>
          {Object.entries(SR_STATUS).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load} className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-100">
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </button>
          <button onClick={() => setShow(true)}
            className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white text-[12px] font-semibold h-8 px-3 rounded-lg transition-colors">
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />New Return
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white z-10 shadow-[0_1px_0_0_#e2e8f0]">
            <tr>
              {["Sr No.","Return No.","Distributor","Debit Note No.","Status","Items","Return Value ₹","Date","Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold text-slate-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="py-24 text-center"><Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto" /></td></tr>
            ) : returns.length === 0 ? (
              <tr><td colSpan={9}>
                <EmptyState icon={RotateCcw} title="No supplier returns yet"
                  desc="Track damaged, expired, or incorrect goods returned to distributors" />
              </td></tr>
            ) : returns.map((sr, i) => (
              <tr key={sr.id} className="border-b border-slate-100 hover:bg-red-50/10 transition-colors group">
                <td className="px-4 py-3 text-[12px] text-slate-400 tabular-nums">{(page - 1) * 20 + i + 1}</td>
                <td className="px-4 py-3 text-[13px] font-bold text-red-600">{sr.returnNumber}</td>
                <td className="px-4 py-3 text-[13px] font-semibold text-slate-800">{sr.supplier.name}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{sr.debitNoteNo ?? "—"}</td>
                <td className="px-4 py-3"><StatusBadge status={sr.status} cfg={SR_STATUS} /></td>
                <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{sr._count.items}</td>
                <td className="px-4 py-3 text-[13px] font-semibold text-slate-800 tabular-nums">{currency(sr.totalAmount)}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{fmtDate(sr.createdAt)}</td>
                <td className="px-4 py-3">
                  {sr.status === "DRAFT" && (
                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <ActionBtn onClick={() => confirm(sr.id)} disabled={actionId === sr.id}
                        icon={actionId === sr.id ? Loader2 : Check} label="Confirm"
                        cls="text-blue-600 border-blue-200 hover:bg-blue-50" />
                      <ActionBtn onClick={() => cancel(sr.id)} disabled={actionId === sr.id}
                        icon={X} label="Cancel" cls="text-red-500 border-red-100 hover:bg-red-50" />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={Math.ceil(total / 20) || 1} total={total} limit={20} onChange={setPage} />

      <AnimatePresence>
        {showCreate && <CreateReturnModal suppliers={suppliers} onClose={() => setShow(false)} onDone={() => { setShow(false); load(); }} />}
      </AnimatePresence>
    </div>
  );
}
