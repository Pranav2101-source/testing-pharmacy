import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  ClipboardList, Plus, X, Loader2, FileX, CheckCircle2,
  Clock, AlertCircle, Ban, PlayCircle, ChevronRight,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

type AuditStatus = "DRAFT" | "IN_PROGRESS" | "COMPLETED" | "APPROVED" | "CANCELLED";

type AuditSession = {
  id:              string;
  sessionNumber:   string;
  status:          AuditStatus;
  notes:           string | null;
  createdAt:       string;
  startedAt:       string | null;
  completedAt:     string | null;
  approvedAt:      string | null;
  createdBy:       string;
  countedItems:    number;
  itemsWithVariance: number;
  _count:          { items: number };
};

// ─── Status config ──────────────────────────────────────────────────────────

const STATUS_CFG: Record<AuditStatus, { label: string; cls: string; icon: React.ElementType }> = {
  DRAFT:       { label: "Draft",       cls: "bg-slate-100 text-slate-600",   icon: Clock        },
  IN_PROGRESS: { label: "Counting",    cls: "bg-blue-50 text-blue-700",      icon: PlayCircle   },
  COMPLETED:   { label: "Completed",   cls: "bg-amber-50 text-amber-700",    icon: AlertCircle  },
  APPROVED:    { label: "Approved",    cls: "bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
  CANCELLED:   { label: "Cancelled",   cls: "bg-red-50 text-red-600",        icon: Ban          },
};

function StatusBadge({ status }: { status: AuditStatus }) {
  const cfg  = STATUS_CFG[status];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-bold rounded-full px-2.5 py-1 whitespace-nowrap", cfg.cls)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Create Session Modal ────────────────────────────────────────────────────

function CreateAuditModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [notes,  setNotes]  = useState("");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      await api.post("/stock-audit", { notes: notes || undefined });
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to create audit session");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">New Stock Audit</h2>
            <p className="text-[12px] text-slate-400 mt-0.5">A snapshot of all active inventory will be taken</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <div className="text-[12px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[12px] text-amber-800">
            <strong>What happens:</strong> The system will snapshot the current quantity of every active inventory batch.
            Staff will then enter actual counted quantities. Discrepancies are applied as stock adjustments upon approval.
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Notes (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              placeholder="e.g. Month-end count, Post-Diwali audit…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 resize-none" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-[13px] font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-2">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Start Audit
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function StockAuditPage() {
  const navigate = useNavigate();
  const [sessions,    setSessions]    = useState<AuditSession[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [filter,      setFilter]      = useState<AuditStatus | "">("");
  const [showCreate,  setShowCreate]  = useState(false);
  const [page,        setPage]        = useState(1);
  const [total,       setTotal]       = useState(0);
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/stock-audit", { params: { page, limit: LIMIT, status: filter || undefined } });
      const d   = res.data.data;
      setSessions(d.items ?? []);
      setTotal(d.total ?? 0);
    } finally { setLoading(false); }
  }, [page, filter]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-slate-900">Stock Audit</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">Physical inventory count sessions</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-[13px] font-semibold rounded-lg hover:bg-blue-700 transition-colors">
          <Plus className="w-4 h-4" /> New Audit
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {(["", "DRAFT", "IN_PROGRESS", "COMPLETED", "APPROVED", "CANCELLED"] as const).map((s) => (
          <button key={s} onClick={() => { setFilter(s); setPage(1); }}
            className={cn("px-3 py-1.5 text-[12px] font-semibold rounded-lg border transition-all",
              filter === s
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
            )}>
            {s === "" ? "All" : STATUS_CFG[s].label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-slate-400">
            <FileX className="w-8 h-8" />
            <span className="text-[13px]">No audit sessions found</span>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wide">Session</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wide">Items</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wide">Variances</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wide">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {sessions.map((session) => (
                <tr key={session.id} className="hover:bg-slate-50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/dashboard/stock-audit/${session.id}`)}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800">{session.sessionNumber}</div>
                    {session.notes && <div className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[200px]">{session.notes}</div>}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={session.status} /></td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-slate-700">{session.countedItems ?? 0}</span>
                    <span className="text-slate-400"> / {session._count.items}</span>
                  </td>
                  <td className="px-4 py-3">
                    {session.itemsWithVariance > 0
                      ? <span className="font-semibold text-amber-600">{session.itemsWithVariance}</span>
                      : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{fmt(session.createdAt)}</td>
                  <td className="px-4 py-3">
                    <ChevronRight className="w-4 h-4 text-slate-300" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <span className="text-[12px] text-slate-400">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 text-[12px] font-medium border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors">Prev</button>
              <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 text-[12px] font-medium border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors">Next</button>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showCreate && (
          <CreateAuditModal
            onClose={() => setShowCreate(false)}
            onDone={() => { setShowCreate(false); load(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
