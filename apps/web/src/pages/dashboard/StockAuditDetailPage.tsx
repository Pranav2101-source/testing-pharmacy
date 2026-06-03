import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft, Loader2, CheckCircle2, PlayCircle, Check,
  AlertCircle, Ban, Clock, TrendingUp, TrendingDown, Minus,
  ChevronDown, ChevronUp, FileX,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

type AuditStatus = "DRAFT" | "IN_PROGRESS" | "COMPLETED" | "APPROVED" | "CANCELLED";

type AuditItem = {
  id:          string;
  expectedQty: number;
  countedQty:  number | null;
  varianceQty: number | null;
  notes:       string | null;
  inventory: {
    id:          string;
    batchNumber: string;
    expiryDate:  string;
    quantity:    number;
    location:    string | null;
    medicine: { id: string; name: string; genericName: string | null; form: string | null; strength: string | null };
    shelf: { id: string; code: string; rack: { id: string; code: string; name: string } } | null;
  };
};

type AuditSession = {
  id:            string;
  sessionNumber: string;
  status:        AuditStatus;
  notes:         string | null;
  createdAt:     string;
  startedAt:     string | null;
  completedAt:   string | null;
  approvedAt:    string | null;
  createdBy:     string;
  items:         AuditItem[];
  _count:        { items: number };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<AuditStatus, { label: string; cls: string; icon: React.ElementType }> = {
  DRAFT:       { label: "Draft",     cls: "bg-slate-100 text-slate-600",    icon: Clock        },
  IN_PROGRESS: { label: "Counting",  cls: "bg-blue-50 text-blue-700",       icon: PlayCircle   },
  COMPLETED:   { label: "Completed", cls: "bg-amber-50 text-amber-700",     icon: AlertCircle  },
  APPROVED:    { label: "Approved",  cls: "bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
  CANCELLED:   { label: "Cancelled", cls: "bg-red-50 text-red-600",         icon: Ban          },
};

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function VarianceBadge({ v }: { v: number | null }) {
  if (v === null) return <span className="text-slate-300">—</span>;
  if (v === 0) return <span className="flex items-center gap-1 text-slate-400"><Minus className="w-3 h-3" />0</span>;
  if (v > 0)   return <span className="flex items-center gap-1 text-emerald-600 font-semibold"><TrendingUp className="w-3 h-3" />+{v}</span>;
  return           <span className="flex items-center gap-1 text-red-600 font-semibold"><TrendingDown className="w-3 h-3" />{v}</span>;
}

// ─── Approve Confirm Modal ────────────────────────────────────────────────────

function ApproveModal({ session, onClose, onDone }: {
  session: AuditSession; onClose: () => void; onDone: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const variances = session.items.filter((i) => i.varianceQty !== null && i.varianceQty !== 0);

  async function approve() {
    setSaving(true); setError(null);
    try {
      await api.post(`/stock-audit/${session.id}/approve`, {});
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to approve session");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
      >
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-[15px] font-bold text-slate-900">Approve Stock Audit</h2>
          <p className="text-[12px] text-slate-400 mt-0.5">This will apply all variances as stock adjustments</p>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="text-[12px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-slate-50 rounded-xl p-3">
              <div className="text-[20px] font-bold text-slate-800">{session._count.items}</div>
              <div className="text-[11px] text-slate-500">Total items</div>
            </div>
            <div className="bg-amber-50 rounded-xl p-3">
              <div className="text-[20px] font-bold text-amber-700">{variances.length}</div>
              <div className="text-[11px] text-amber-600">With variance</div>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <div className="text-[20px] font-bold text-slate-800">
                {session._count.items - variances.length}
              </div>
              <div className="text-[11px] text-slate-500">No change</div>
            </div>
          </div>

          {variances.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[12px] text-amber-800">
              <strong>{variances.length} adjustment{variances.length > 1 ? "s" : ""}</strong> will be written to the stock ledger.
              This action cannot be undone.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-4 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
            <button onClick={approve} disabled={saving}
              className="px-4 py-2 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-60 transition-colors flex items-center gap-2">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Approve & Apply
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function StockAuditDetailPage() {
  const { id }    = useParams<{ id: string }>();
  const navigate  = useNavigate();
  const [session,      setSession]      = useState<AuditSession | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showApprove,  setShowApprove]  = useState(false);
  const [counts,       setCounts]       = useState<Record<string, string>>({});
  const [savingItem,   setSavingItem]   = useState<string | null>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [search,       setSearch]       = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.get(`/stock-audit/${id}`);
      const s   = res.data.data as AuditSession;
      setSession(s);
      // Pre-fill counted qty inputs from existing data
      const initial: Record<string, string> = {};
      s.items.forEach((item) => {
        if (item.countedQty !== null) initial[item.id] = String(item.countedQty);
      });
      setCounts(initial);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function doAction(action: string, payload?: Record<string, unknown>) {
    if (!id) return;
    setActionLoading(true); setError(null);
    try {
      await api.request({
        method:  action === "cancel" ? "delete" : ["start", "items"].includes(action) ? "patch" : "post",
        url:     `/stock-audit/${id}${action !== "cancel" && action !== "start" ? `/${action}` : action === "start" ? "/start" : ""}`,
        data:    payload ?? {},
      });
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? `Failed to ${action}`);
    } finally { setActionLoading(false); }
  }

  async function saveCount(item: AuditItem) {
    const val = counts[item.id];
    if (val === undefined || val === "") return;
    const num = parseInt(val);
    if (isNaN(num) || num < 0) return;
    setSavingItem(item.id);
    try {
      await api.patch(`/stock-audit/${id}/items/${item.id}`, { countedQty: num });
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to save count");
    } finally { setSavingItem(null); }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
    </div>
  );

  if (!session) return (
    <div className="flex flex-col items-center justify-center h-64 gap-2 text-slate-400">
      <FileX className="w-8 h-8" />
      <span>Audit session not found</span>
    </div>
  );

  const cfg     = STATUS_CFG[session.status];
  const Icon    = cfg.icon;
  const counted = session.items.filter((i) => i.countedQty !== null).length;
  const progress = session._count.items > 0 ? (counted / session._count.items) * 100 : 0;
  const canEdit = session.status === "IN_PROGRESS";

  const filteredItems = session.items.filter((item) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      item.inventory.medicine.name.toLowerCase().includes(q) ||
      item.inventory.batchNumber.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Back + Header */}
      <div className="flex items-start gap-4">
        <button onClick={() => navigate("/dashboard/stock-audit")}
          className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors">
          <ArrowLeft className="w-4 h-4 text-slate-500" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[20px] font-bold text-slate-900">{session.sessionNumber}</h1>
            <span className={cn("inline-flex items-center gap-1 text-[11px] font-bold rounded-full px-2.5 py-1", cfg.cls)}>
              <Icon className="w-3 h-3" />{cfg.label}
            </span>
          </div>
          <p className="text-[12px] text-slate-400 mt-0.5">
            Created {fmt(session.createdAt)}
            {session.startedAt   && ` · Started ${fmt(session.startedAt)}`}
            {session.completedAt && ` · Completed ${fmt(session.completedAt)}`}
            {session.approvedAt  && ` · Approved ${fmt(session.approvedAt)}`}
          </p>
          {session.notes && <p className="text-[12px] text-slate-500 mt-1">{session.notes}</p>}
        </div>
      </div>

      {error && (
        <div className="text-[13px] text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>
      )}

      {/* Progress + Actions */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-6 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <div className="flex justify-between text-[12px] text-slate-500 mb-1">
            <span>Counting progress</span>
            <span className="font-semibold">{counted} / {session._count.items}</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {session.status === "DRAFT" && (
            <button onClick={() => doAction("start")} disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-[13px] font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors">
              {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
              Start Counting
            </button>
          )}
          {session.status === "IN_PROGRESS" && (
            <button onClick={() => doAction("complete")} disabled={actionLoading || counted < session._count.items}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-[13px] font-semibold rounded-lg hover:bg-amber-700 disabled:opacity-60 transition-colors"
              title={counted < session._count.items ? "Count all items first" : ""}>
              {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Mark Complete
            </button>
          )}
          {session.status === "COMPLETED" && (
            <button onClick={() => setShowApprove(true)} disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-[13px] font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-60 transition-colors">
              <Check className="w-3.5 h-3.5" /> Approve & Apply
            </button>
          )}
          {["DRAFT", "IN_PROGRESS"].includes(session.status) && (
            <button onClick={() => doAction("cancel")} disabled={actionLoading}
              className="flex items-center gap-2 px-3 py-2 border border-red-200 text-red-600 text-[13px] font-semibold rounded-lg hover:bg-red-50 disabled:opacity-60 transition-colors">
              <Ban className="w-3.5 h-3.5" /> Cancel
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search medicine or batch…"
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 pl-4" />
      </div>

      {/* Items table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wide">Medicine</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wide">Batch</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wide">Location</th>
              <th className="text-center px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wide">Expected</th>
              <th className="text-center px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wide">Counted</th>
              <th className="text-center px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wide">Variance</th>
              {canEdit && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredItems.map((item) => {
              const localVal = counts[item.id] ?? "";
              const localNum = localVal !== "" ? parseInt(localVal) : null;
              const variance = localNum !== null ? localNum - item.expectedQty : item.varianceQty;
              const isDirty  = localNum !== null && localNum !== item.countedQty;

              return (
                <tr key={item.id} className={cn(
                  "hover:bg-slate-50 transition-colors",
                  item.countedQty === null && canEdit && "bg-amber-50/30",
                )}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800">{item.inventory.medicine.name}</div>
                    <div className="text-[11px] text-slate-400">
                      {item.inventory.medicine.form} {item.inventory.medicine.strength}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 font-mono text-[12px]">{item.inventory.batchNumber}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {item.inventory.shelf
                      ? <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md text-[11px] font-medium">{item.inventory.shelf.rack.code}/{item.inventory.shelf.code}</span>
                      : item.inventory.location
                        ? <span className="text-slate-400 text-[12px]">{item.inventory.location}</span>
                        : <span className="text-slate-300 text-[12px]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center font-semibold text-slate-700">{item.expectedQty}</td>
                  <td className="px-4 py-3 text-center">
                    {canEdit ? (
                      <input
                        type="number" min={0} value={localVal}
                        onChange={(e) => setCounts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        onBlur={() => { if (isDirty) saveCount(item); }}
                        placeholder="—"
                        className={cn(
                          "w-20 text-center border rounded-lg px-2 py-1.5 text-[13px] font-semibold focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all",
                          item.countedQty !== null ? "border-slate-200 text-slate-800" : "border-amber-300 bg-amber-50 text-amber-800 placeholder:text-amber-400",
                        )}
                      />
                    ) : (
                      <span className={cn("font-semibold", item.countedQty === null ? "text-slate-300" : "text-slate-700")}>
                        {item.countedQty ?? "—"}
                      </span>
                    )}
                    {savingItem === item.id && <Loader2 className="inline ml-1.5 w-3 h-3 text-blue-400 animate-spin" />}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <VarianceBadge v={isDirty ? variance : item.varianceQty} />
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      {isDirty && (
                        <button onClick={() => saveCount(item)} disabled={savingItem === item.id}
                          className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-40">
                          Save
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {showApprove && (
          <ApproveModal
            session={session}
            onClose={() => setShowApprove(false)}
            onDone={() => { setShowApprove(false); load(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
