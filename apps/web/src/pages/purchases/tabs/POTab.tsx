import { useState, useCallback, useEffect } from "react";
import { Loader2, RefreshCw, Plus, FileText, Check, X, Send } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { PurchaseOrder, Supplier } from "../types";
import { PO_STATUS, APPROVAL_STATUS } from "../types";
import { fmtDate, currency } from "../utils";
import { FilterBar } from "../components/FilterBar";
import { Pagination } from "../components/Pagination";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import { ActionBtn } from "../modals/shared";
import { CreatePOModal } from "../modals/CreatePOModal";

export function POTab({ suppliers }: { suppliers: Supplier[] }) {
  const [orders, setOrders]       = useState<PurchaseOrder[]>([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [supplierId, setSupp]     = useState("");
  const [status, setStatus]       = useState("");
  const [dateFrom, setFrom]       = useState("");
  const [dateTo, setTo]           = useState("");
  const [showCreate, setShow]     = useState(false);
  const [actionId, setAction]     = useState<string | null>(null);
  const [approveId, setApproveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p: Record<string, any> = { page, limit: 20 };
      if (search)     p.search     = search;
      if (supplierId) p.supplierId = supplierId;
      if (status)     p.status     = status;
      if (dateFrom)   p.from       = new Date(dateFrom).toISOString();
      if (dateTo)     p.to         = new Date(dateTo + "T23:59:59").toISOString();
      const { data } = await api.get("/purchases/orders", { params: p });
      setOrders(data.data.items); setTotal(data.data.total);
    } catch {/* */} finally { setLoading(false); }
  }, [page, search, supplierId, status, dateFrom, dateTo]);

  useEffect(() => { const t = setTimeout(load, search ? 350 : 0); return () => clearTimeout(t); }, [load]);

  async function sendPO(id: string) {
    setAction(id);
    try { await api.patch(`/purchases/orders/${id}/send`); load(); }
    catch (e: any) { alert(e?.response?.data?.error ?? "Cannot send"); } finally { setAction(null); }
  }

  async function cancelPO(id: string) {
    if (!window.confirm("Cancel this purchase order?")) return;
    setAction(id);
    try { await api.delete(`/purchases/orders/${id}`); load(); }
    catch {/* */} finally { setAction(null); }
  }

  async function approvePO(id: string, approved: boolean) {
    setApproveId(id);
    try { await api.patch(`/purchases/orders/${id}/approve`, { approved }); load(); }
    catch (e: any) { alert(e?.response?.data?.error ?? "Failed"); } finally { setApproveId(null); }
  }

  return (
    <div className="flex flex-col h-full">
      <FilterBar search={search} onSearch={(v) => { setSearch(v); setPage(1); }}
        supplierId={supplierId} onSupplier={(v) => { setSupp(v); setPage(1); }} suppliers={suppliers}
        dateFrom={dateFrom} dateTo={dateTo} onDateFrom={(v) => { setFrom(v); setPage(1); }} onDateTo={(v) => { setTo(v); setPage(1); }}
        statusValue={status} onStatus={(v) => { setStatus(v); setPage(1); }}
        statusOptions={Object.entries(PO_STATUS).map(([v, c]) => ({ value: v, label: c.label }))}
        rightSlot={
          <>
            <button onClick={load} className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-100">
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            </button>
            <button onClick={() => setShow(true)}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-semibold h-8 px-3 rounded-lg transition-colors">
              <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />New PO
            </button>
          </>
        }
      />

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white z-10 shadow-[0_1px_0_0_#e2e8f0]">
            <tr>
              {["Sr No.","PO Number","Distributor","Invoice No.","Status","Approval","Items","Total ₹","Expected","Date","Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold text-slate-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="py-24 text-center"><Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto" /></td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={11}>
                <EmptyState icon={FileText} title="No purchase orders found"
                  desc="Create a PO to track what you've ordered from suppliers"
                  action="Create First PO" onAction={() => setShow(true)} />
              </td></tr>
            ) : orders.map((po, i) => (
              <tr key={po.id} className={cn("border-b border-slate-100 hover:bg-blue-50/20 transition-colors group",
                po.approvalStatus === "PENDING_APPROVAL" && "bg-orange-50/30")}>
                <td className="px-4 py-3 text-[12px] text-slate-400 tabular-nums">{(page - 1) * 20 + i + 1}</td>
                <td className="px-4 py-3 text-[13px] font-bold text-blue-600">{po.orderNumber}</td>
                <td className="px-4 py-3 text-[13px] font-semibold text-slate-800">{po.supplier.name}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{po.invoiceNo ?? "—"}</td>
                <td className="px-4 py-3"><StatusBadge status={po.status} cfg={PO_STATUS} /></td>
                <td className="px-4 py-3">
                  {po.approvalStatus !== "NOT_REQUIRED" && (
                    <span className={cn("inline-flex items-center text-[11px] font-semibold border rounded-full px-2 py-0.5 whitespace-nowrap", APPROVAL_STATUS[po.approvalStatus]?.cls)}>
                      {APPROVAL_STATUS[po.approvalStatus]?.label}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{po._count.items}</td>
                <td className="px-4 py-3 text-[13px] font-semibold text-slate-800 tabular-nums">{currency(po.totalAmount)}</td>
                <td className="px-4 py-3 text-[12px] text-slate-400">{fmtDate(po.expectedDate)}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{fmtDate(po.orderedAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {po.approvalStatus === "PENDING_APPROVAL" && (
                      <>
                        <ActionBtn onClick={() => approvePO(po.id, true)} disabled={approveId === po.id}
                          icon={Check} label="Approve" cls="text-green-600 border-green-200 hover:bg-green-50" />
                        <ActionBtn onClick={() => approvePO(po.id, false)} disabled={approveId === po.id}
                          icon={X} label="Reject" cls="text-red-500 border-red-100 hover:bg-red-50" />
                      </>
                    )}
                    {po.status === "DRAFT" && po.approvalStatus !== "PENDING_APPROVAL" && po.approvalStatus !== "REJECTED" && (
                      <ActionBtn onClick={() => sendPO(po.id)} disabled={actionId === po.id}
                        icon={actionId === po.id ? Loader2 : Send} label="Send"
                        cls="text-amber-600 border-amber-200 hover:bg-amber-50" />
                    )}
                    {!["RECEIVED", "CANCELLED"].includes(po.status) && (
                      <ActionBtn onClick={() => cancelPO(po.id)} disabled={actionId === po.id}
                        icon={X} label="Cancel" cls="text-red-500 border-red-100 hover:bg-red-50" />
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
        {showCreate && <CreatePOModal suppliers={suppliers} onClose={() => setShow(false)} onDone={() => { setShow(false); load(); }} />}
      </AnimatePresence>
    </div>
  );
}
