import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ListSkeleton } from "@/components/Skeleton";
import {
  ClipboardList, Plus, X, Loader2, CheckCircle2,
  Clock, AlertCircle, Ban, PlayCircle, ChevronRight, ArrowRight,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

type AuditStatus = "DRAFT" | "IN_PROGRESS" | "COMPLETED" | "APPROVED" | "CANCELLED";

type AuditSession = {
  id:               string;
  sessionNumber:    string;
  status:           AuditStatus;
  notes:            string | null;
  createdAt:        string;
  startedAt:        string | null;
  completedAt:      string | null;
  approvedAt:       string | null;
  createdBy:        string;
  countedItems:     number;
  itemsWithVariance: number;
  _count:           { items: number };
};

// ─── Status config ───────────────────────────────────────────────────────────

const STATUS_CFG: Record<AuditStatus, { label: string; cls: string; icon: React.ElementType }> = {
  DRAFT:       { label: "Draft",       cls: "bg-slate-100 text-slate-600",    icon: Clock        },
  IN_PROGRESS: { label: "Counting",    cls: "bg-blue-50 text-blue-700",       icon: PlayCircle   },
  COMPLETED:   { label: "Needs Review",cls: "bg-amber-50 text-amber-700",     icon: AlertCircle  },
  APPROVED:    { label: "Approved",    cls: "bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
  CANCELLED:   { label: "Cancelled",   cls: "bg-red-50 text-red-600",         icon: Ban          },
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

function duration(from: string, to: string | null) {
  const ms = (to ? new Date(to) : new Date()).getTime() - new Date(from).getTime();
  const h  = Math.floor(ms / 3600000);
  const m  = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── Create Session Modal ────────────────────────────────────────────────────

function CreateAuditModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [notes,  setNotes]  = useState("");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const res = await api.post("/stock-audit", { notes: notes || undefined });
      onCreated(res.data.data.id);
    } catch (err: any) {
      setError((err as Error).message || "Failed to create audit session");
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
            <p className="text-[12px] text-slate-400 mt-0.5">Snapshot all active batches and begin counting</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <div className="text-[12px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
            {[
              "A snapshot of every active inventory batch is taken instantly",
              "Staff physically count each batch and enter quantities",
              "Discrepancies are reviewed, then applied as stock adjustments on approval",
            ].map((s, i) => (
              <div key={i} className="flex items-start gap-2 text-[12px] text-blue-800">
                <span className="w-4 h-4 rounded-full bg-blue-200 text-blue-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                {s}
              </div>
            ))}
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Reason / Notes (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder="e.g. Monthly count, Post-Diwali audit, Surprise check…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 resize-none" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-[13px] font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-2">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Create &amp; Open
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Session Row ─────────────────────────────────────────────────────────────

function SessionRow({ session, onClick }: { session: AuditSession; onClick: () => void }) {
  const total   = session._count.items;
  const counted = session.countedItems ?? 0;
  const pct     = total > 0 ? Math.round((counted / total) * 100) : 0;
  const isActive = session.status === "IN_PROGRESS";
  const needsApproval = session.status === "COMPLETED";

  return (
    <tr
      className={cn(
        "cursor-pointer transition-colors group",
        isActive      && "bg-blue-50/40 hover:bg-blue-50",
        needsApproval && "bg-amber-50/30 hover:bg-amber-50/60",
        !isActive && !needsApproval && "hover:bg-slate-50",
      )}
      onClick={onClick}
    >
      {/* Session number + notes */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] font-bold text-slate-800">{session.sessionNumber}</span>
          {isActive && (
            <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full animate-pulse">LIVE</span>
          )}
        </div>
        {session.notes && (
          <div className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[220px]">{session.notes}</div>
        )}
      </td>

      {/* Status */}
      <td className="px-4 py-3.5">
        <StatusBadge status={session.status} />
      </td>

      {/* Progress */}
      <td className="px-4 py-3.5">
        {session.status !== "DRAFT" ? (
          <div className="w-32">
            <div className="flex justify-between text-[11px] text-slate-500 mb-1">
              <span>{counted}/{total}</span>
              <span className="font-semibold text-slate-700">{pct}%</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", pct === 100 ? "bg-emerald-500" : "bg-blue-500")}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ) : (
          <span className="text-[12px] text-slate-400">{total} items</span>
        )}
      </td>

      {/* Variances */}
      <td className="px-4 py-3.5">
        {session.itemsWithVariance > 0 ? (
          <span className="inline-flex items-center gap-1 text-[12px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            {session.itemsWithVariance} variance{session.itemsWithVariance !== 1 ? "s" : ""}
          </span>
        ) : session.status === "APPROVED" ? (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-600">
            <CheckCircle2 className="w-3 h-3" /> No variance
          </span>
        ) : (
          <span className="text-slate-300 text-[12px]">—</span>
        )}
      </td>

      {/* Date + duration */}
      <td className="px-4 py-3.5">
        <div className="text-[12px] text-slate-600">{fmt(session.createdAt)}</div>
        {session.startedAt && (
          <div className="text-[11px] text-slate-400 mt-0.5">
            {session.status === "APPROVED" || session.status === "COMPLETED"
              ? `Took ${duration(session.startedAt, session.completedAt)}`
              : `Running ${duration(session.startedAt, null)}`}
          </div>
        )}
      </td>

      {/* CTA */}
      <td className="px-4 py-3.5">
        {isActive ? (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue-600 group-hover:gap-2 transition-all">
            Resume <ArrowRight className="w-3.5 h-3.5" />
          </span>
        ) : needsApproval ? (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-amber-600 group-hover:gap-2 transition-all">
            Review <ArrowRight className="w-3.5 h-3.5" />
          </span>
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-400 transition-colors" />
        )}
      </td>
    </tr>
  );
}

// ─── Audit Content (embeddable) ──────────────────────────────────────────────
// Exported without its own page title so it can be rendered as a tab inside
// InventoryPage. StockAuditPage (the default export) wraps this with a header.

export function StockAuditContent() {
  const navigate = useNavigate();
  const [sessions,   setSessions]   = useState<AuditSession[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState<AuditStatus | "">("");
  const [showCreate, setShowCreate] = useState(false);
  const [page,       setPage]       = useState(1);
  const [total,      setTotal]      = useState(0);
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

  const totalPages   = Math.ceil(total / LIMIT);
  const inProgress   = sessions.filter((s) => s.status === "IN_PROGRESS").length;
  const needsApproval = sessions.filter((s) => s.status === "COMPLETED").length;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* ── Action row ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-[13px] text-slate-500">Physical inventory count sessions</p>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white text-[13px] font-semibold rounded-xl hover:bg-orange-600 transition-colors shadow-sm">
          <Plus className="w-4 h-4" /> New Audit
        </button>
      </div>

      {/* ── KPI chips ────────────────────────────────────────────────────────── */}
      {!loading && (inProgress > 0 || needsApproval > 0) && (
        <div className="flex gap-3 flex-wrap">
          {inProgress > 0 && (
            <button onClick={() => { setFilter("IN_PROGRESS"); setPage(1); }}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-blue-700 text-[13px] font-semibold hover:bg-blue-100 transition-colors">
              <PlayCircle className="w-4 h-4" />
              {inProgress} count{inProgress > 1 ? "s" : ""} in progress
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          {needsApproval > 0 && (
            <button onClick={() => { setFilter("COMPLETED"); setPage(1); }}
              className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-[13px] font-semibold hover:bg-amber-100 transition-colors">
              <AlertCircle className="w-4 h-4" />
              {needsApproval} awaiting approval
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* ── Filter tabs ──────────────────────────────────────────────────────── */}
      <div className="flex gap-1.5 flex-wrap">
        {(["", "IN_PROGRESS", "COMPLETED", "DRAFT", "APPROVED", "CANCELLED"] as const).map((s) => (
          <button key={s} onClick={() => { setFilter(s); setPage(1); }}
            className={cn(
              "px-3 py-1.5 text-[12px] font-semibold rounded-lg border transition-all",
              filter === s
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50",
            )}>
            {s === "" ? "All Sessions" : STATUS_CFG[s].label}
          </button>
        ))}
      </div>

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <ListSkeleton />
        ) : sessions.length === 0 ? (
          <div className="p-8">
            {filter ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-slate-400">
                <ClipboardList className="w-8 h-8 text-slate-200" />
                <p className="text-[13px] font-semibold text-slate-500">No sessions with status "{STATUS_CFG[filter as AuditStatus].label}"</p>
                <button onClick={() => setFilter("")} className="text-[12px] text-blue-600 font-semibold hover:underline">Show all sessions</button>
              </div>
            ) : (
              <div className="max-w-md mx-auto text-center py-6 space-y-5">
                <div className="w-14 h-14 rounded-2xl bg-orange-100 flex items-center justify-center mx-auto">
                  <ClipboardList className="w-7 h-7 text-orange-500" />
                </div>
                <div>
                  <p className="text-[16px] font-bold text-slate-800">No audits yet</p>
                  <p className="text-[13px] text-slate-400 mt-1">Stock audits help you find missing stock, expired batches, and billing errors by physically counting your pharmacy shelf by shelf.</p>
                </div>
                <div className="grid grid-cols-3 gap-3 text-left">
                  {[
                    { emoji: "📷", title: "Snapshot", desc: "All active batches captured instantly" },
                    { emoji: "🔢", title: "Count",    desc: "Walk the shelves, type what you see" },
                    { emoji: "✅", title: "Approve",  desc: "Stock corrected, losses documented" },
                  ].map((s) => (
                    <div key={s.title} className="bg-slate-50 rounded-xl p-3 space-y-1">
                      <div className="text-[18px]">{s.emoji}</div>
                      <div className="text-[12px] font-bold text-slate-700">{s.title}</div>
                      <div className="text-[11px] text-slate-400">{s.desc}</div>
                    </div>
                  ))}
                </div>
                <button onClick={() => setShowCreate(true)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-orange-500 text-white text-[14px] font-bold rounded-xl hover:bg-orange-600 transition-colors shadow-sm mx-auto">
                  <Plus className="w-4 h-4" /> Start Your First Audit
                </button>
              </div>
            )}
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wide">Session</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wide">Progress</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wide">Variances</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wide">Date</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  onClick={() => navigate(`/dashboard/stock-audit/${session.id}`)}
                />
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/60">
            <span className="text-[12px] text-slate-400">
              Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
            </span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 text-[12px] font-medium border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors">‹ Prev</button>
              <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 text-[12px] font-medium border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors">Next ›</button>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showCreate && (
          <CreateAuditModal
            onClose={() => setShowCreate(false)}
            onCreated={(id) => { setShowCreate(false); navigate(`/dashboard/stock-audit/${id}`); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default function StockAuditPage() {
  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <div className="flex items-center gap-3 px-5 border-b border-slate-200 flex-shrink-0" style={{ height: "52px" }}>
        <ClipboardList className="w-4 h-4 text-orange-500" />
        <h1 className="text-[18px] font-bold text-slate-900 leading-none">Stock Audit</h1>
      </div>
      <div className="flex-1 overflow-auto min-h-0">
        <StockAuditContent />
      </div>
    </div>
  );
}
