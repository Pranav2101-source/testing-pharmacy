import { useState, useCallback, useEffect } from "react";
import { Loader2, RefreshCw, Plus, Search, X, Building2, Phone, Mail, MapPin, Edit2, History, CreditCard } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { FullSupplier } from "../types";
import { fmtDate, currency } from "../utils";
import { Pagination } from "../components/Pagination";
import { SupplierFormModal } from "../modals/SupplierFormModal";

// ─── Supplier History Modal ────────────────────────────────────────────────────

type HistoryData = {
  orders:     { items: { id: string; orderNumber: string; status: string; totalAmount: number; orderedAt: string; _count: { items: number } }[] };
  recentGRNs: { id: string; grnNumber: string; status: string; totalAmount: number; createdAt: string }[];
  summary:    { totalOrders: number; totalSpend: number };
};

function SupplierHistoryModal({ supplier, onClose }: { supplier: FullSupplier; onClose: () => void }) {
  const [data,    setData]    = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/suppliers/${supplier.id}/history`)
      .then(({ data }) => setData(data.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [supplier.id]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }} transition={{ duration: 0.16 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[86vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">Purchase History</h2>
            <p className="text-[12px] text-slate-400 mt-0.5">{supplier.name}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center"><X className="w-4 h-4 text-slate-400" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /></div>
          ) : !data ? (
            <p className="text-center py-16 text-slate-400">No history found</p>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-blue-50 rounded-xl p-4">
                  <p className="text-[11px] font-bold text-blue-400 uppercase tracking-wide">Total Orders</p>
                  <p className="text-[26px] font-black text-blue-700 mt-1">{data.summary.totalOrders}</p>
                </div>
                <div className="bg-emerald-50 rounded-xl p-4">
                  <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wide">Total Spend</p>
                  <p className="text-[22px] font-black text-emerald-700 mt-1">₹{data.summary.totalSpend.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
                </div>
              </div>
              {(supplier.creditLimit > 0 || supplier.creditDays > 0) && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                  <p className="text-[12px] font-bold text-amber-600 mb-2 flex items-center gap-1.5"><CreditCard className="w-3.5 h-3.5" />Credit Terms</p>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div><p className="text-[10px] text-amber-500 font-semibold uppercase">Limit</p><p className="text-[15px] font-bold text-amber-800">₹{supplier.creditLimit.toLocaleString("en-IN")}</p></div>
                    <div><p className="text-[10px] text-amber-500 font-semibold uppercase">Days</p><p className="text-[15px] font-bold text-amber-800">{supplier.creditDays}d</p></div>
                    <div><p className="text-[10px] text-amber-500 font-semibold uppercase">Terms</p><p className="text-[13px] font-semibold text-amber-700">{supplier.paymentTerms || "—"}</p></div>
                  </div>
                </div>
              )}
              {data.recentGRNs.length > 0 && (
                <div>
                  <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-2">Recent Receipts (GRNs)</p>
                  <div className="space-y-1.5">
                    {data.recentGRNs.map((grn) => (
                      <div key={grn.id} className="flex items-center justify-between bg-emerald-50/50 border border-emerald-100 rounded-lg px-3 py-2.5">
                        <div><p className="text-[13px] font-bold text-emerald-700">{grn.grnNumber}</p><p className="text-[11px] text-slate-400">{fmtDate(grn.createdAt)}</p></div>
                        <div className="text-right"><p className="text-[13px] font-semibold text-slate-700">₹{grn.totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p><p className={cn("text-[10px] font-bold", grn.status === "CONFIRMED" ? "text-emerald-600" : "text-amber-600")}>{grn.status}</p></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ─── Distributors Tab ─────────────────────────────────────────────────────────

export function DistributorsTab({ onSupplierAdded }: { onSupplierAdded: (s: FullSupplier) => void }) {
  const [suppliers,  setSuppliers]  = useState<FullSupplier[]>([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState("");
  const [modal,      setModal]      = useState<"add" | "edit" | null>(null);
  const [editing,    setEditing]    = useState<FullSupplier | null>(null);
  const [historyFor, setHistoryFor] = useState<FullSupplier | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, limit: 20 };
      if (search.trim()) params.search = search.trim();
      const { data } = await api.get("/suppliers", { params });
      setSuppliers(data.data.items);
      setTotal(data.data.total);
    } catch {/* */} finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => { const t = setTimeout(load, search ? 350 : 0); return () => clearTimeout(t); }, [load]);

  function handleSaved(saved: FullSupplier) {
    setSuppliers((p) => {
      const idx = p.findIndex((s) => s.id === saved.id);
      if (idx >= 0) { const n = [...p]; n[idx] = saved; return n; }
      return [saved, ...p];
    });
    setModal(null); setEditing(null);
    if (!editing) onSupplierAdded(saved);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-white flex-shrink-0">
        <div className="flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden h-8 max-w-[280px] flex-1">
          <Search className="w-3.5 h-3.5 text-slate-400 ml-2.5 flex-shrink-0" />
          <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search distributor name, city…"
            className="flex-1 px-2 text-[12px] placeholder-slate-400 focus:outline-none h-full bg-transparent" />
          {search && <button onClick={() => setSearch("")} className="mr-2 text-slate-300 hover:text-slate-500"><X className="w-3 h-3" /></button>}
        </div>
        <span className="text-[12px] text-slate-400 ml-1">{total} distributor{total !== 1 ? "s" : ""}</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load} className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-100">
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </button>
          <button onClick={() => { setEditing(null); setModal("add"); }}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-semibold h-8 px-3 rounded-lg transition-colors">
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />Add Distributor
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white z-10 shadow-[0_1px_0_0_#e2e8f0]">
            <tr>
              {["Distributor Name","Contact","City / State","GSTIN","Drug Lic.","Credit Limit","Credit Days","Payment Terms","POs",""].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold text-slate-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="py-24 text-center"><Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto" /></td></tr>
            ) : suppliers.length === 0 ? (
              <tr><td colSpan={10}>
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
                    <Building2 className="w-7 h-7 text-blue-300" />
                  </div>
                  <p className="text-[15px] font-semibold text-slate-700 mb-1">No distributors yet</p>
                  <p className="text-[13px] text-slate-400 mb-4 max-w-xs">Add your medicine distributors here first, then you can place purchase orders against them.</p>
                  <button onClick={() => { setEditing(null); setModal("add"); }}
                    className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold px-4 py-2 rounded-lg transition-colors">
                    <Plus className="w-4 h-4" />Add First Distributor
                  </button>
                </div>
              </td></tr>
            ) : suppliers.map((s) => (
              <tr key={s.id} className="border-b border-slate-100 hover:bg-blue-50/20 transition-colors group">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                    <div>
                      <p className="text-[13px] font-bold text-slate-800">{s.name}</p>
                      {!s.isActive && <span className="text-[10px] font-bold text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">Inactive</span>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-[12px] text-slate-500 space-y-0.5">
                    {s.phone && <p className="flex items-center gap-1"><Phone className="w-3 h-3 text-slate-300" />{s.phone}</p>}
                    {s.email && <p className="flex items-center gap-1 max-w-[150px] truncate"><Mail className="w-3 h-3 text-slate-300 flex-shrink-0" />{s.email}</p>}
                    {!s.phone && !s.email && <span className="text-slate-300">—</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-[12px] text-slate-500">
                  {(s.city || s.state)
                    ? <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-slate-300" />{[s.city, s.state].filter(Boolean).join(", ")}</span>
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-[11px] font-mono text-slate-500">{s.gstin ?? "—"}</td>
                <td className="px-4 py-3 text-[11px] text-slate-500">{s.dlNumber ?? "—"}</td>
                <td className="px-4 py-3 text-[12px] text-slate-700 tabular-nums">
                  {s.creditLimit > 0 ? `₹${s.creditLimit.toLocaleString("en-IN")}` : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3">
                  {s.creditDays > 0
                    ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">{s.creditDays} days</span>
                    : <span className="text-slate-300 text-[12px]">—</span>}
                </td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{s.paymentTerms ?? "—"}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{(s._count as any)?.purchaseOrders ?? 0}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setEditing(s); setModal("edit"); }}
                      className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-md px-2 py-1 transition-colors">
                      <Edit2 className="w-3 h-3" />Edit
                    </button>
                    <button onClick={() => setHistoryFor(s)}
                      className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 border border-slate-200 hover:bg-slate-50 rounded-md px-2 py-1 transition-colors">
                      <History className="w-3 h-3" />History
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={Math.ceil(total / 20) || 1} total={total} limit={20} onChange={setPage} />

      <AnimatePresence>
        {(modal === "add" || modal === "edit") && (
          <SupplierFormModal supplier={modal === "edit" ? editing : null} onClose={() => { setModal(null); setEditing(null); }} onSaved={handleSaved} />
        )}
        {historyFor && <SupplierHistoryModal supplier={historyFor} onClose={() => setHistoryFor(null)} />}
      </AnimatePresence>
    </div>
  );
}
