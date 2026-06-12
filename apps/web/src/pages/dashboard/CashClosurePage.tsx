import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Banknote, Plus, Loader2, CheckCircle2, AlertTriangle,
  ChevronLeft, ChevronRight, X, Lock, AlertCircle,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

interface CashClosure {
  id: string; closureDate: string; status: "DRAFT" | "CLOSED" | "DISPUTED";
  openingCash: number; cashSales: number; upiSales: number; cardSales: number;
  creditSales: number; walletSales: number; expectedCash: number;
  actualCash: number; variance: number; notes: string | null;
  closedAt: string | null;
  user: { id: string; name: string };
}

function fmt(n: number) {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function todayIST(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ── Status badge ──────────────────────────────────────────────────
function StatusBadge({ status }: { status: CashClosure["status"] }) {
  const map: Record<CashClosure["status"], string> = {
    DRAFT:    "bg-amber-50 text-amber-700",
    CLOSED:   "bg-emerald-50 text-emerald-700",
    DISPUTED: "bg-red-50 text-red-600",
  };
  return (
    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", map[status])}>
      {status}
    </span>
  );
}

// ── Init Modal ────────────────────────────────────────────────────
function InitModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ closureDate: todayIST(), openingCash: 0, actualCash: 0, notes: "" });
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/cash-closure", form);
      toast.success("Cash closure initialised");
      qc.invalidateQueries({ queryKey: ["cash-closure"] });
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? "Failed to create closure");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
          <h2 className="text-[15px] font-bold text-slate-800">Start Cash Closure</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Closure Date</label>
            <input type="date" value={form.closureDate} max={todayIST()}
              onChange={e => setForm(f => ({ ...f, closureDate: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Opening Cash (₹)</label>
            <input type="number" min={0} step="0.01" value={form.openingCash}
              onChange={e => setForm(f => ({ ...f, openingCash: parseFloat(e.target.value) || 0 }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
            <p className="text-[11px] text-slate-400 mt-1">Cash in the drawer at start of day</p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Actual Cash in Drawer (₹)</label>
            <input type="number" min={0} step="0.01" value={form.actualCash}
              onChange={e => setForm(f => ({ ...f, actualCash: parseFloat(e.target.value) || 0 }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Notes</label>
            <textarea value={form.notes} rows={2}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-[12px] font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-[12px] font-bold">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Start Closure
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Close Modal ───────────────────────────────────────────────────
function CloseModal({ closure, onClose }: { closure: CashClosure; onClose: () => void }) {
  const [actualCash, setActualCash] = useState(closure.actualCash);
  const [notes, setNotes]           = useState(closure.notes ?? "");
  const [saving, setSaving]         = useState(false);
  const toast = useToast();
  const qc = useQueryClient();

  const expectedCash = closure.openingCash + closure.cashSales;
  const variance     = actualCash - expectedCash;

  async function handleClose(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/cash-closure/${closure.id}/close`, { actualCash, notes });
      toast.success("Cash closure finalised");
      qc.invalidateQueries({ queryKey: ["cash-closure"] });
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? "Failed to close");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
          <h2 className="text-[15px] font-bold text-slate-800">Finalise Cash Closure — {closure.closureDate}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleClose} className="p-6 space-y-4">
          {/* Sales breakdown */}
          <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-[13px]">
            {[
              ["Opening Cash",  fmt(closure.openingCash)],
              ["Cash Sales",    fmt(closure.cashSales)],
              ["UPI Sales",     fmt(closure.upiSales)],
              ["Card Sales",    fmt(closure.cardSales)],
              ["Credit Sales",  fmt(closure.creditSales)],
              ["Wallet Sales",  fmt(closure.walletSales)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <span className="text-slate-500">{label}</span>
                <span className="font-medium text-slate-700">{value}</span>
              </div>
            ))}
            <div className="border-t border-slate-200 pt-2 flex justify-between font-bold">
              <span>Expected Cash</span>
              <span>{fmt(expectedCash)}</span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Actual Cash in Drawer (₹)</label>
            <input type="number" min={0} step="0.01" value={actualCash}
              onChange={e => setActualCash(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
          </div>

          <div className={cn("flex items-center justify-between rounded-xl px-4 py-3 text-[13px] font-bold",
            variance === 0 ? "bg-emerald-50 text-emerald-700" : variance > 0 ? "bg-blue-50 text-blue-700" : "bg-red-50 text-red-600")}>
            <span>Variance</span>
            <span>{variance >= 0 ? "+" : ""}{fmt(variance)}</span>
          </div>

          {variance !== 0 && (
            <div className="flex items-start gap-2 text-[12px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{variance > 0 ? "Cash surplus" : "Cash shortage"} detected. Add a note explaining the difference.</span>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Notes</label>
            <textarea value={notes} rows={2} onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 resize-none" />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-[12px] font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-[12px] font-bold">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
              Finalise &amp; Lock
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────
export default function CashClosurePage() {
  const [page, setPage]   = useState(1);
  const [initModal, setInitModal] = useState(false);
  const [closeModal, setCloseModal] = useState<CashClosure | null>(null);
  const toast = useToast();
  const qc = useQueryClient();

  const params = new URLSearchParams({ page: String(page), limit: "20" });
  const { data, isLoading } = useQuery({
    queryKey: ["cash-closure", page],
    queryFn:  () => api.get<{ success: boolean; data: CashClosure[]; total: number; pages: number }>(`/cash-closure?${params}`).then(r => r.data),
  });

  async function handleDispute(c: CashClosure) {
    try {
      await api.post(`/cash-closure/${c.id}/dispute`);
      toast.success("Marked as disputed");
      qc.invalidateQueries({ queryKey: ["cash-closure"] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? "Failed");
    }
  }

  const closures = data?.data ?? [];
  const pages    = data?.pages ?? 1;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center">
            <Banknote className="w-5 h-5 text-emerald-600" strokeWidth={1.8} />
          </div>
          <div>
            <h1 className="text-[17px] font-bold text-slate-800">Day-End Cash Closure</h1>
            <p className="text-[12px] text-slate-500">Reconcile and lock daily cash at EOD</p>
          </div>
        </div>
        <button
          onClick={() => setInitModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-bold transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> New Closure
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-300" /></div>
        ) : closures.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Banknote className="w-10 h-10 text-slate-200 mb-3" strokeWidth={1.4} />
            <p className="text-[13px] font-medium">No closures yet</p>
            <button onClick={() => setInitModal(true)} className="mt-3 text-[12px] text-emerald-600 font-semibold hover:underline">Start today's closure</button>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-[11px] font-semibold">
                {["Date", "Status", "Opening", "Cash Sales", "Expected", "Actual", "Variance", "Closed By", "Actions"].map(h => (
                  <th key={h} className="px-4 py-3 text-right first:text-left last:text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {closures.map(c => (
                <tr key={c.id} className="border-t border-slate-50 hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-semibold text-slate-700">{c.closureDate}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-right text-slate-600">{fmt(c.openingCash)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{fmt(c.cashSales)}</td>
                  <td className="px-4 py-3 text-right font-medium">{fmt(c.expectedCash)}</td>
                  <td className="px-4 py-3 text-right font-medium">{fmt(c.actualCash)}</td>
                  <td className={cn("px-4 py-3 text-right font-bold",
                    c.variance === 0 ? "text-emerald-600" : c.variance > 0 ? "text-blue-600" : "text-red-500")}>
                    {c.variance >= 0 ? "+" : ""}{fmt(c.variance)}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{c.user.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {c.status === "DRAFT" && (
                        <button onClick={() => setCloseModal(c)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-[11px] font-bold transition-colors">
                          <Lock className="w-3 h-3" /> Finalise
                        </button>
                      )}
                      {c.status === "CLOSED" && (
                        <button onClick={() => handleDispute(c)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 text-[11px] font-bold transition-colors">
                          <AlertTriangle className="w-3 h-3" /> Dispute
                        </button>
                      )}
                      {c.status === "DISPUTED" && (
                        <div className="flex items-center gap-1 text-[11px] text-red-500 font-semibold">
                          <AlertCircle className="w-3.5 h-3.5" /> Under review
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="p-1.5 rounded-lg border border-slate-200 text-slate-500 disabled:opacity-40 hover:bg-slate-50">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[12px] text-slate-500">Page {page} of {pages}</span>
          <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
            className="p-1.5 rounded-lg border border-slate-200 text-slate-500 disabled:opacity-40 hover:bg-slate-50">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {initModal  && <InitModal  onClose={() => setInitModal(false)} />}
      {closeModal && <CloseModal closure={closeModal} onClose={() => setCloseModal(null)} />}
    </div>
  );
}
