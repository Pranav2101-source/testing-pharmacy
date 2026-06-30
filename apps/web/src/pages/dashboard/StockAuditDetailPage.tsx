import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft, Loader2, CheckCircle2, PlayCircle, Check,
  AlertCircle, Ban, Clock, TrendingUp, TrendingDown, Minus,
  FileX, MapPin, Package, Keyboard, MessageSquare,
  ClipboardCheck, ShieldAlert,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { getStoredUser } from "@/lib/auth";
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
    id:           string;
    batchNumber:  string;
    expiryDate:   string;
    quantity:     number;
    location:     string | null;
    mrp:          number;
    purchaseRate: number;
    medicine: { id: string; name: string; genericName: string | null; form: string | null; strength: string | null };
    shelf: { id: string; code: string; level: number; rack: { id: string; code: string; name: string } } | null;
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
  approvedBy:    string | null;
  approver:      { id: string; name: string } | null;
  createdBy:     string;
  items:         AuditItem[];
  _count:        { items: number };
};

type ShelfGroup = { key: string; shelfId: string | null; shelfCode: string | null; shelfLevel: number | null; items: AuditItem[] };
type RackGroup  = { rackId: string | null; rackCode: string | null; rackName: string | null; shelves: ShelfGroup[] };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<AuditStatus, { label: string; cls: string; icon: React.ElementType }> = {
  DRAFT:       { label: "Draft",        cls: "bg-slate-100 text-slate-600",    icon: Clock        },
  IN_PROGRESS: { label: "Counting",     cls: "bg-blue-50 text-blue-700",       icon: PlayCircle   },
  COMPLETED:   { label: "Needs Review", cls: "bg-amber-50 text-amber-700",     icon: AlertCircle  },
  APPROVED:    { label: "Approved",     cls: "bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
  CANCELLED:   { label: "Cancelled",    cls: "bg-red-50 text-red-600",         icon: Ban          },
};

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}
function fmtLong(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function dur(from: string, to: string | null) {
  const m = Math.round(((to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()) / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
function inr(v: number) {
  return `₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function VarianceBadge({ v, preview }: { v: number | null; preview?: boolean }) {
  if (v === null) return <span className="text-slate-300 text-[12px]">—</span>;
  if (v === 0)   return <span className="flex items-center gap-1 text-slate-400 text-[12px]"><Minus className="w-3 h-3" />0</span>;
  if (v > 0)     return <span className={cn("flex items-center gap-1 font-semibold text-[12px]", preview ? "text-blue-500" : "text-emerald-600")}><TrendingUp className="w-3 h-3" />+{v}</span>;
  return             <span className={cn("flex items-center gap-1 font-semibold text-[12px]", preview ? "text-blue-500" : "text-red-600")}><TrendingDown className="w-3 h-3" />{v}</span>;
}

// ─── Group items by rack → shelf ─────────────────────────────────────────────

function buildGroups(items: AuditItem[]): RackGroup[] {
  const rackMap = new Map<string, RackGroup>();
  const noLoc: AuditItem[] = [];

  for (const item of items) {
    const shelf = item.inventory.shelf;
    if (shelf) {
      const rack = shelf.rack;
      if (!rackMap.has(rack.id)) rackMap.set(rack.id, { rackId: rack.id, rackCode: rack.code, rackName: rack.name, shelves: [] });
      const rg = rackMap.get(rack.id)!;
      let sg = rg.shelves.find((s) => s.shelfId === shelf.id);
      if (!sg) { sg = { key: `${rack.id}__${shelf.id}`, shelfId: shelf.id, shelfCode: shelf.code, shelfLevel: shelf.level, items: [] }; rg.shelves.push(sg); }
      sg.items.push(item);
    } else { noLoc.push(item); }
  }

  const groups = Array.from(rackMap.values()).sort((a, b) => (a.rackCode ?? "").localeCompare(b.rackCode ?? ""));
  groups.forEach((g) => {
    g.shelves.sort((a, b) => (a.shelfLevel ?? 0) - (b.shelfLevel ?? 0) || (a.shelfCode ?? "").localeCompare(b.shelfCode ?? ""));
    g.shelves.forEach((s) => s.items.sort((a, b) => a.inventory.medicine.name.localeCompare(b.inventory.medicine.name)));
  });
  if (noLoc.length) {
    noLoc.sort((a, b) => a.inventory.medicine.name.localeCompare(b.inventory.medicine.name));
    groups.push({ rackId: null, rackCode: null, rackName: null, shelves: [{ key: "no-location", shelfId: null, shelfCode: null, shelfLevel: null, items: noLoc }] });
  }
  return groups;
}

// ─── Post-Approval Summary ────────────────────────────────────────────────────

function PostApprovalSummary({ session }: { session: AuditSession }) {
  const matched   = session.items.filter((i) => i.varianceQty === 0);
  const gained    = session.items.filter((i) => (i.varianceQty ?? 0) > 0);
  const lost      = session.items.filter((i) => (i.varianceQty ?? 0) < 0);

  const gainUnits  = gained.reduce((s, i) => s + (i.varianceQty ?? 0), 0);
  const lossUnits  = lost.reduce((s, i) => s + (i.varianceQty ?? 0), 0);
  const gainValue  = gained.reduce((s, i) => s + Math.abs(i.varianceQty ?? 0) * Number(i.inventory.mrp), 0);
  const lossValue  = lost.reduce((s, i) => s + Math.abs(i.varianceQty ?? 0) * Number(i.inventory.mrp), 0);
  const netValue   = gainValue - lossValue;
  const elapsed    = session.startedAt ? dur(session.startedAt, session.approvedAt) : null;

  return (
    <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-50 to-teal-50 px-6 py-4 border-b border-emerald-100 flex items-center gap-4">
        <div className="w-11 h-11 rounded-xl bg-emerald-600 flex items-center justify-center flex-shrink-0">
          <ClipboardCheck className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h3 className="text-[15px] font-bold text-emerald-900">Audit Approved &amp; Applied</h3>
          <p className="text-[12px] text-emerald-700 mt-0.5">
            {fmtLong(session.approvedAt!)} · {session._count.items} items audited{elapsed && ` · took ${elapsed}`}
            {session.approver && ` · by ${session.approver.name}`}
          </p>
        </div>
        {netValue < 0 && (
          <div className="text-right">
            <div className="text-[11px] text-red-600 font-semibold">Net Shrinkage</div>
            <div className="text-[18px] font-bold text-red-700">{inr(netValue)}</div>
          </div>
        )}
        {netValue > 0 && (
          <div className="text-right">
            <div className="text-[11px] text-emerald-600 font-semibold">Net Surplus</div>
            <div className="text-[18px] font-bold text-emerald-700">+{inr(netValue)}</div>
          </div>
        )}
        {netValue === 0 && gained.length === 0 && lost.length === 0 && (
          <div className="text-right">
            <div className="text-[11px] text-emerald-600 font-semibold">Perfect Count</div>
            <div className="text-[18px] font-bold text-emerald-700">₹0 variance</div>
          </div>
        )}
      </div>

      {/* 4 summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-slate-100">
        <div className="p-5">
          <div className="text-[28px] font-bold text-slate-700 leading-none">{matched.length}</div>
          <div className="text-[12px] font-semibold text-slate-500 mt-1">Items Matched</div>
          <div className="text-[11px] text-slate-400 mt-0.5">No adjustment</div>
        </div>
        <div className="p-5 bg-emerald-50/50">
          <div className="text-[28px] font-bold text-emerald-700 leading-none">{gained.length}</div>
          <div className="text-[12px] font-semibold text-emerald-600 mt-1">Items Gained</div>
          {gained.length > 0 ? (
            <div className="text-[11px] text-emerald-600 mt-0.5 font-semibold">+{gainUnits} units · +{inr(gainValue)}</div>
          ) : (
            <div className="text-[11px] text-slate-400 mt-0.5">None</div>
          )}
        </div>
        <div className="p-5 bg-red-50/50">
          <div className="text-[28px] font-bold text-red-700 leading-none">{lost.length}</div>
          <div className="text-[12px] font-semibold text-red-600 mt-1">Items Missing</div>
          {lost.length > 0 ? (
            <div className="text-[11px] text-red-600 mt-0.5 font-semibold">{lossUnits} units · -{inr(lossValue)}</div>
          ) : (
            <div className="text-[11px] text-slate-400 mt-0.5">None</div>
          )}
        </div>
        <div className={cn("p-5", Math.abs(netValue) < 1 ? "bg-emerald-50/30" : netValue < 0 ? "bg-red-50/40" : "bg-emerald-50/40")}>
          <div className={cn("text-[28px] font-bold leading-none", netValue < 0 ? "text-red-700" : "text-emerald-700")}>
            {netValue > 0 ? "+" : ""}{inr(netValue)}
          </div>
          <div className={cn("text-[12px] font-semibold mt-1", netValue < 0 ? "text-red-600" : "text-emerald-600")}>
            Net {netValue < 0 ? "Shrinkage" : netValue > 0 ? "Surplus" : "Impact"}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">at MRP value</div>
        </div>
      </div>
    </div>
  );
}

// ─── Smart Complete Modal ─────────────────────────────────────────────────────

function SmartCompleteModal({ uncountedCount, onMarkAndComplete, onCancel, loading }: {
  uncountedCount: number; onMarkAndComplete: () => void; onCancel: () => void; loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm"
      >
        <div className="p-6 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto">
            <AlertCircle className="w-7 h-7 text-amber-600" />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-slate-900">{uncountedCount} items not counted</h2>
            <p className="text-[13px] text-slate-500 mt-1.5 leading-relaxed">
              Mark all uncounted items as <strong>0</strong> and complete the audit? Items with 0 counted will show a variance if stock was expected.
            </p>
          </div>
          <div className="flex flex-col gap-2 pt-1">
            <button onClick={onMarkAndComplete} disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 text-white text-[13px] font-semibold rounded-xl hover:bg-amber-700 disabled:opacity-60 transition-colors">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Mark {uncountedCount} as 0 &amp; Complete
            </button>
            <button onClick={onCancel}
              className="w-full px-4 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
              Go back and count manually
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Approve Modal ────────────────────────────────────────────────────────────

function ApproveModal({ session, onClose, onDone }: { session: AuditSession; onClose: () => void; onDone: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const variances  = session.items.filter((i) => i.varianceQty !== null && i.varianceQty !== 0);
  const gainValue  = variances.filter((i) => (i.varianceQty ?? 0) > 0).reduce((s, i) => s + (i.varianceQty ?? 0) * Number(i.inventory.mrp), 0);
  const lossValue  = variances.filter((i) => (i.varianceQty ?? 0) < 0).reduce((s, i) => s + Math.abs(i.varianceQty ?? 0) * Number(i.inventory.mrp), 0);
  const gainUnits  = variances.filter((i) => (i.varianceQty ?? 0) > 0).reduce((s, i) => s + (i.varianceQty ?? 0), 0);
  const lossUnits  = variances.filter((i) => (i.varianceQty ?? 0) < 0).reduce((s, i) => s + (i.varianceQty ?? 0), 0);
  const net        = gainValue - lossValue;

  async function approve() {
    setSaving(true); setError(null);
    try { await api.post(`/stock-audit/${session.id}/approve`, {}); onDone(); }
    catch (err: any) { setError((err as Error).message || "Failed to approve"); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
      >
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-[15px] font-bold text-slate-900">Approve &amp; Apply to Stock</h2>
          <p className="text-[12px] text-slate-400 mt-0.5">Variances will be written to the stock ledger — this cannot be undone.</p>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="text-[12px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

          {/* Summary counts */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-slate-50 rounded-xl p-3">
              <div className="text-[20px] font-bold text-slate-800">{session._count.items}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Total items</div>
            </div>
            <div className={cn("rounded-xl p-3", variances.length > 0 ? "bg-amber-50" : "bg-emerald-50")}>
              <div className={cn("text-[20px] font-bold", variances.length > 0 ? "text-amber-700" : "text-emerald-700")}>{variances.length}</div>
              <div className={cn("text-[11px] mt-0.5", variances.length > 0 ? "text-amber-600" : "text-emerald-600")}>{variances.length > 0 ? "With variance" : "All match ✓"}</div>
            </div>
            <div className={cn("rounded-xl p-3", net < 0 ? "bg-red-50" : "bg-emerald-50")}>
              <div className={cn("text-[20px] font-bold", net < 0 ? "text-red-700" : "text-emerald-700")}>{net > 0 ? "+" : ""}{inr(net)}</div>
              <div className={cn("text-[11px] mt-0.5", net < 0 ? "text-red-600" : "text-emerald-600")}>Net impact</div>
            </div>
          </div>

          {/* Rupee breakdown */}
          {variances.length > 0 && (
            <div className="bg-slate-50 rounded-xl divide-y divide-slate-100">
              {gainUnits > 0 && (
                <div className="flex items-center justify-between px-4 py-2.5 text-[13px]">
                  <span className="flex items-center gap-2 text-slate-600"><TrendingUp className="w-3.5 h-3.5 text-emerald-500" /> Gain</span>
                  <span className="font-semibold text-emerald-600">+{gainUnits} units · +{inr(gainValue)}</span>
                </div>
              )}
              {lossUnits < 0 && (
                <div className="flex items-center justify-between px-4 py-2.5 text-[13px]">
                  <span className="flex items-center gap-2 text-slate-600"><TrendingDown className="w-3.5 h-3.5 text-red-500" /> Shrinkage</span>
                  <span className="font-semibold text-red-600">{lossUnits} units · -{inr(lossValue)}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
            <button onClick={approve} disabled={saving}
              className="px-4 py-2 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-60 transition-colors flex items-center gap-2">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Approve &amp; Apply
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type FilterMode = "all" | "uncounted" | "variance";

export default function StockAuditDetailPage() {
  const { id }   = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [session,           setSession]           = useState<AuditSession | null>(null);
  const [loading,           setLoading]           = useState(true);
  const [actionLoading,     setActionLoading]     = useState(false);
  const [showApprove,       setShowApprove]       = useState(false);
  const [showSmartComplete, setShowSmartComplete] = useState(false);
  const [counts,            setCounts]            = useState<Record<string, string>>({});
  const [savingItem,        setSavingItem]        = useState<string | null>(null);
  const [error,             setError]             = useState<string | null>(null);
  const [search,            setSearch]            = useState("");
  const [filterMode,        setFilterMode]        = useState<FilterMode>("all");
  const [expandedNotes,     setExpandedNotes]     = useState<Set<string>>(new Set());
  const [notesDraft,        setNotesDraft]        = useState<Record<string, string>>({});
  const [zeroConfirmShelf,  setZeroConfirmShelf]  = useState<string | null>(null);
  const [zeroingShelf,      setZeroingShelf]      = useState<string | null>(null);
  const [matchingShelf,     setMatchingShelf]     = useState<string | null>(null);
  const [matchConfirmShelf, setMatchConfirmShelf] = useState<string | null>(null);
  const [showAllItems,      setShowAllItems]      = useState(false);

  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async (forceRefreshCounts = false) => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.get(`/stock-audit/${id}`);
      const s   = res.data.data as AuditSession;
      setSession(s);
      // forceRefreshCounts=true after bulk actions (zero-all, mark-all) so the
      // display matches server truth even if optimistic state was not updated.
      setCounts(forceRefreshCounts
        ? () => {
            const next: Record<string, string> = {};
            s.items.forEach((item) => { if (item.countedQty !== null) next[item.id] = String(item.countedQty); });
            return next;
          }
        : (prev) => {
            const next = { ...prev };
            // Only initialise entries that haven't been typed yet so we don't
            // clobber in-progress input with a stale server value.
            s.items.forEach((item) => { if (item.countedQty !== null && !(item.id in next)) next[item.id] = String(item.countedQty); });
            return next;
          },
      );
      setNotesDraft((prev) => {
        const next = { ...prev };
        s.items.forEach((item) => { if (item.notes && !(item.id in next)) next[item.id] = item.notes; });
        return next;
      });
    } catch (err: any) {
      setError((err as Error).message || "Failed to load session");
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // ── Derived: groups + flat ordered IDs ──────────────────────────────────────

  const allGroups = useMemo(() => buildGroups(session?.items ?? []), [session?.items]);

  const filteredGroups = useMemo(() => {
    return allGroups.map((rg) => ({
      ...rg,
      shelves: rg.shelves.map((sg) => ({
        ...sg,
        items: sg.items.filter((item) => {
          if (search) {
            const q = search.toLowerCase();
            if (!item.inventory.medicine.name.toLowerCase().includes(q) && !item.inventory.batchNumber.toLowerCase().includes(q)) return false;
          }
          if (filterMode === "uncounted") return item.countedQty === null;
          if (filterMode === "variance")  return item.varianceQty !== null && item.varianceQty !== 0;
          return true;
        }),
      })).filter((sg) => sg.items.length > 0),
    })).filter((rg) => rg.shelves.length > 0);
  }, [allGroups, search, filterMode]);

  // Walking-order IDs over ALL items (unfiltered) — used by focusNext so Enter
  // navigation works correctly regardless of which filter tab is active.
  const allFlatItemIds = useMemo(
    () => allGroups.flatMap((rg) => rg.shelves.flatMap((sg) => sg.items.map((i) => i.id))),
    [allGroups],
  );

  // Auto-focus first uncounted input when session enters IN_PROGRESS
  const hasAutoFocused = useRef(false);
  useEffect(() => {
    if (!session || session.status !== "IN_PROGRESS") return;
    if (hasAutoFocused.current) return;
    hasAutoFocused.current = true;
    setTimeout(() => {
      const firstId = allFlatItemIds.find(
        (cid) => session.items.find((i) => i.id === cid)?.countedQty === null && inputRefs.current.has(cid),
      );
      if (firstId) { const el = inputRefs.current.get(firstId); el?.focus(); el?.select(); }
    }, 150);
  }, [session?.status, allFlatItemIds]);

  // ── Summary stats with rupee values ─────────────────────────────────────────

  const stats = useMemo(() => {
    const items        = session?.items ?? [];
    const counted      = items.filter((i) => i.countedQty !== null).length;
    const varItems     = items.filter((i) => i.varianceQty !== null && i.varianceQty !== 0);
    const gainItems    = varItems.filter((i) => (i.varianceQty ?? 0) > 0);
    const lossItems    = varItems.filter((i) => (i.varianceQty ?? 0) < 0);
    const gainUnits    = gainItems.reduce((s, i) => s + (i.varianceQty ?? 0), 0);
    const lossUnits    = lossItems.reduce((s, i) => s + (i.varianceQty ?? 0), 0);
    const gainValue    = gainItems.reduce((s, i) => s + (i.varianceQty ?? 0) * Number(i.inventory.mrp), 0);
    const lossValue    = lossItems.reduce((s, i) => s + Math.abs(i.varianceQty ?? 0) * Number(i.inventory.mrp), 0);
    return { total: items.length, counted, uncounted: items.length - counted, varianceCount: varItems.length, gainUnits, lossUnits, gainValue, lossValue };
  }, [session]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function doStart() {
    if (!id) return;
    setActionLoading(true); setError(null);
    try { await api.patch(`/stock-audit/${id}/start`, {}); load(); }
    catch (err: any) { setError((err as Error).message || "Failed to start"); }
    finally { setActionLoading(false); }
  }

  async function doComplete() {
    if (!id) return;
    setActionLoading(true); setError(null);
    try { await api.post(`/stock-audit/${id}/complete`, {}); load(); }
    catch (err: any) { setError((err as Error).message || "Failed to complete"); }
    finally { setActionLoading(false); }
  }

  async function doCancel() {
    if (!id) return;
    setActionLoading(true); setError(null);
    try {
      await api.delete(`/stock-audit/${id}`);
      navigate("/dashboard/inventory?tab=audit");
    }
    catch (err: any) { setError((err as Error).message || "Failed to cancel"); }
    finally { setActionLoading(false); }
  }

  async function doReopen() {
    if (!id) return;
    setActionLoading(true); setError(null);
    try {
      await api.patch(`/stock-audit/${id}/reopen`, {});
      hasAutoFocused.current = false; // allow re-focus after reopen
      load();
    }
    catch (err: any) { setError((err as Error).message || "Failed to reopen"); }
    finally { setActionLoading(false); }
  }

  async function doMarkAllAndComplete() {
    if (!id || !session) return;
    setActionLoading(true); setError(null);
    try {
      const uncounted = session.items.filter((i) => i.countedQty === null);
      if (uncounted.length > 0) {
        // Single batch request instead of N parallel PATCHes.
        const res = await api.patch(`/stock-audit/${id}/items`, {
          items: uncounted.map((i) => ({ itemId: i.id, countedQty: 0 })),
        });
        const updatedMap = new Map((res.data.data as AuditItem[]).map((i) => [i.id, i]));
        setCounts((prev) => { const next = { ...prev }; uncounted.forEach((i) => { next[i.id] = "0"; }); return next; });
        setSession((prev) => prev ? { ...prev, items: prev.items.map((i) => updatedMap.get(i.id) ?? i) } : null);
      }
      await api.post(`/stock-audit/${id}/complete`, {});
      setShowSmartComplete(false);
      load(true);
    } catch (err: any) { setError((err as Error).message || "Failed to complete"); }
    finally { setActionLoading(false); }
  }

  // ── Per-shelf: zero all uncounted ────────────────────────────────────────────

  async function zeroShelf(shelfKey: string, items: AuditItem[]) {
    if (!id) return;
    const uncounted = items.filter((i) => i.countedQty === null);
    if (!uncounted.length) return;
    setZeroingShelf(shelfKey);
    try {
      const res = await api.patch(`/stock-audit/${id}/items`, {
        items: uncounted.map((i) => ({ itemId: i.id, countedQty: 0 })),
      });
      const updatedMap = new Map((res.data.data as AuditItem[]).map((i) => [i.id, i]));
      setCounts((prev) => { const next = { ...prev }; uncounted.forEach((i) => { next[i.id] = "0"; }); return next; });
      setSession((prev) => {
        if (!prev) return prev;
        return { ...prev, items: prev.items.map((i) => updatedMap.get(i.id) ?? i) };
      });
    } catch (err: any) { setError((err as Error).message || "Failed to zero shelf"); }
    finally { setZeroingShelf(null); setZeroConfirmShelf(null); }
  }

  // ── Per-item: mark as matching expected qty ──────────────────────────────────

  async function matchItem(item: AuditItem) {
    const val = item.expectedQty;
    setCounts((prev) => ({ ...prev, [item.id]: String(val) }));
    await saveCountValue(item, val);
    focusNext(item.id);
  }

  // ── Per-shelf: match all uncounted items to expected qty ──────────────────────

  async function matchShelf(shelfKey: string, items: AuditItem[]) {
    if (!id) return;
    const uncounted = items.filter((i) => i.countedQty === null);
    if (!uncounted.length) return;
    setMatchingShelf(shelfKey);
    try {
      const res = await api.patch(`/stock-audit/${id}/items`, {
        items: uncounted.map((i) => ({ itemId: i.id, countedQty: i.expectedQty })),
      });
      const updatedMap = new Map((res.data.data as AuditItem[]).map((i) => [i.id, i]));
      setCounts((prev) => { const next = { ...prev }; uncounted.forEach((i) => { next[i.id] = String(i.expectedQty); }); return next; });
      setSession((prev) => {
        if (!prev) return prev;
        return { ...prev, items: prev.items.map((i) => updatedMap.get(i.id) ?? i) };
      });
    } catch (err: any) { setError((err as Error).message || "Failed to match shelf"); }
    finally { setMatchingShelf(null); setMatchConfirmShelf(null); }
  }

  // ── Count saving ─────────────────────────────────────────────────────────────

  async function saveCountValue(item: AuditItem, value: number) {
    if (isNaN(value) || value < 0) return;
    setSavingItem(item.id);
    try {
      await api.patch(`/stock-audit/${id}/items/${item.id}`, { countedQty: value });
      setSession((prev) => {
        if (!prev) return prev;
        return { ...prev, items: prev.items.map((i) => i.id === item.id ? { ...i, countedQty: value, varianceQty: value - i.expectedQty } : i) };
      });
    } catch (err: any) { setError((err as Error).message || "Failed to save count"); }
    finally { setSavingItem(null); }
  }

  async function saveNote(item: AuditItem) {
    const note = notesDraft[item.id] ?? "";
    if (note === (item.notes ?? "")) return;
    try { await api.patch(`/stock-audit/${id}/items/${item.id}`, { notes: note || null }); }
    catch (err: any) { setError((err as Error).message || "Note failed to save — please try again"); }
  }

  // ── Keyboard navigation ───────────────────────────────────────────────────────

  function focusNext(currentId: string) {
    const allItems   = session?.items ?? [];
    const curIdx     = allFlatItemIds.indexOf(currentId);
    const candidates = [...allFlatItemIds.slice(curIdx + 1), ...allFlatItemIds.slice(0, curIdx)];
    // Find next uncounted item that actually has an input rendered (in DOM).
    const nextId = candidates.find((cid) =>
      allItems.find((i) => i.id === cid)?.countedQty === null &&
      inputRefs.current.has(cid),
    );
    if (nextId) { const el = inputRefs.current.get(nextId); el?.focus(); el?.select(); }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, item: AuditItem) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const val = parseInt(counts[item.id] ?? "");
    if (!isNaN(val) && val >= 0) { saveCountValue(item, val); focusNext(item.id); }
  }

  async function markAsZero(item: AuditItem) {
    setCounts((prev) => ({ ...prev, [item.id]: "0" }));
    await saveCountValue(item, 0);
    focusNext(item.id);
  }

  // ── Toggle note expansion ────────────────────────────────────────────────────

  function toggleNote(itemId: string) {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) { next.delete(itemId); } else { next.add(itemId); }
      return next;
    });
  }

  // ── Render guards ─────────────────────────────────────────────────────────────

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 text-slate-300 animate-spin" /></div>;
  if (!session) return <div className="flex flex-col items-center justify-center h-64 gap-2 text-slate-400"><FileX className="w-8 h-8" /><span>Audit session not found</span></div>;

  const cfg          = STATUS_CFG[session.status];
  const Icon         = cfg.icon;
  const canEdit      = session.status === "IN_PROGRESS";
  const isApproved   = session.status === "APPROVED";
  const pct          = stats.total > 0 ? Math.round((stats.counted / stats.total) * 100) : 0;
  const allCounted   = stats.uncounted === 0;
  const userRole     = getStoredUser()?.role ?? "";
  const isOwnerOrMgr = userRole === "OWNER" || userRole === "MANAGER";

  // When approved: show variance items by default (matched items are noise)
  const approvedDisplayItems = isApproved
    ? (showAllItems ? session.items : session.items.filter((i) => i.varianceQty !== null && i.varianceQty !== 0))
    : null;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-4">
        <button onClick={() => navigate("/dashboard/inventory?tab=audit")}
          className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors flex-shrink-0 mt-0.5">
          <ArrowLeft className="w-4 h-4 text-slate-500" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[20px] font-bold text-slate-900 font-mono">{session.sessionNumber}</h1>
            <span className={cn("inline-flex items-center gap-1 text-[11px] font-bold rounded-full px-2.5 py-1", cfg.cls)}>
              <Icon className="w-3 h-3" />{cfg.label}
            </span>
            {session.startedAt && !isApproved && !["CANCELLED"].includes(session.status) && (
              <span className="text-[11px] text-slate-400">
                <Clock className="w-3 h-3 inline mr-1" />Running {dur(session.startedAt, null)}
              </span>
            )}
          </div>
          <p className="text-[12px] text-slate-400 mt-0.5">
            Created {fmtLong(session.createdAt)}
            {session.startedAt   && ` · Started ${fmtLong(session.startedAt)}`}
            {session.completedAt && ` · Completed ${fmtLong(session.completedAt)}`}
            {session.approvedAt  && ` · Approved ${fmtLong(session.approvedAt)}`}
          </p>
          {session.notes && <p className="text-[12px] text-slate-500 mt-1 italic">{session.notes}</p>}
        </div>
      </div>

      {/* ── Step wizard ──────────────────────────────────────────────────── */}
      {!["APPROVED", "CANCELLED"].includes(session.status) && (
        <div className="flex items-center gap-0">
          {[
            { label: "1. Create Audit", active: session.status === "DRAFT",       done: session.status !== "DRAFT" },
            { label: "2. Count Items",  active: session.status === "IN_PROGRESS", done: ["COMPLETED", "APPROVED"].includes(session.status) },
            { label: "3. Approve",      active: session.status === "COMPLETED",   done: false },
          ].map((step, idx) => (
            <div key={step.label} className="flex items-center">
              <div className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-semibold transition-all",
                step.active ? "bg-blue-600 text-white shadow-sm" :
                step.done   ? "bg-emerald-50 text-emerald-700"   :
                              "bg-slate-100 text-slate-400",
              )}>
                {step.done && <Check className="w-3.5 h-3.5" />}
                {step.label}
              </div>
              {idx < 2 && <div className="w-6 h-px bg-slate-200 flex-shrink-0" />}
            </div>
          ))}
        </div>
      )}

      {/* ── DRAFT / COMPLETED hero CTA ────────────────────────────────────── */}
      {session.status === "DRAFT" && (
        <div className="bg-blue-600 rounded-2xl p-5 flex items-center gap-5">
          <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <ClipboardCheck className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold text-white">Audit ready — {stats.total} items to count</p>
            <p className="text-[12px] text-blue-100 mt-0.5">Walk to the first shelf, count the stock, and click <strong>Start Counting</strong> to begin.</p>
          </div>
          <button onClick={doStart} disabled={actionLoading}
            className="flex items-center gap-2 px-5 py-2.5 bg-white text-blue-700 font-bold text-[14px] rounded-xl hover:bg-blue-50 disabled:opacity-60 transition-colors flex-shrink-0 shadow-sm">
            {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            Start Counting
          </button>
        </div>
      )}
      {session.status === "COMPLETED" && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-center gap-5">
          <div className="w-11 h-11 rounded-xl bg-amber-500 flex items-center justify-center flex-shrink-0">
            <ShieldAlert className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold text-amber-900">Counting complete — review variances below</p>
            <p className="text-[12px] text-amber-700 mt-0.5">
              {stats.varianceCount === 0
                ? "All items matched. You can approve this audit."
                : `${stats.varianceCount} item${stats.varianceCount > 1 ? "s" : ""} have variance. Review them, then approve to update your stock.`}
            </p>
            {!isOwnerOrMgr && (
              <p className="text-[11px] text-amber-600 mt-1 font-semibold">Only owners and managers can approve audits.</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isOwnerOrMgr && (
              <button onClick={doReopen} disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2.5 border border-amber-300 text-amber-800 text-[13px] font-semibold rounded-xl hover:bg-amber-100 disabled:opacity-60 transition-colors bg-amber-50">
                <ArrowLeft className="w-3.5 h-3.5" />
                Reopen
              </button>
            )}
            {isOwnerOrMgr && (
              <button onClick={() => setShowApprove(true)} disabled={actionLoading}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white font-bold text-[14px] rounded-xl hover:bg-emerald-700 disabled:opacity-60 transition-colors shadow-sm">
                <Check className="w-4 h-4" />
                Approve &amp; Apply
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 text-[13px] text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600 text-lg leading-none">×</button>
        </div>
      )}

      {/* ── Post-Approval Summary (only when APPROVED) ────────────────────── */}
      {isApproved && <PostApprovalSummary session={session} />}

      {/* ── Summary stats bar (counting state) ───────────────────────────── */}
      {!isApproved && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Total",     value: stats.total,                                    cls: "text-slate-800"  },
            { label: "Counted",   value: stats.counted,                                  cls: "text-emerald-700"},
            { label: "Remaining", value: stats.uncounted,                                cls: stats.uncounted > 0 ? "text-amber-600" : "text-slate-400" },
            { label: "Variances", value: stats.varianceCount,                            cls: stats.varianceCount > 0 ? "text-amber-700" : "text-slate-400" },
            { label: "Gain ₹",    value: stats.gainValue > 0 ? `+${inr(stats.gainValue)}` : "—", cls: stats.gainValue > 0 ? "text-emerald-600" : "text-slate-300" },
            { label: "Loss ₹",    value: stats.lossValue > 0 ? `-${inr(stats.lossValue)}` : "—", cls: stats.lossValue > 0 ? "text-red-600" : "text-slate-300" },
          ].map((s) => (
            <div key={s.label} className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-center shadow-sm">
              <div className={cn("text-[17px] font-bold leading-none tabular-nums", s.cls)}>{s.value}</div>
              <div className="text-[11px] text-slate-400 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Progress + Actions (not shown when approved) ──────────────────── */}
      {!isApproved && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
          <div>
            <div className="flex items-center justify-between text-[12px] text-slate-500 mb-1.5">
              <span>Counting progress</span>
              <span className="font-semibold text-slate-700">{stats.counted} of {stats.total} items · {pct}%</span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div className={cn("h-full rounded-full transition-all duration-500", pct === 100 ? "bg-emerald-500" : "bg-blue-500")} style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap pt-1">
            {session.status === "DRAFT" && (
              <button onClick={doStart} disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-[13px] font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors">
                {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
                Start Counting
              </button>
            )}
            {session.status === "IN_PROGRESS" && (
              <button
                onClick={() => allCounted ? doComplete() : setShowSmartComplete(true)}
                disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-[13px] font-semibold rounded-lg hover:bg-amber-700 disabled:opacity-60 transition-colors">
                {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Mark Complete
                {!allCounted && <span className="text-amber-200 text-[11px]">({stats.uncounted} left)</span>}
              </button>
            )}
            {session.status === "COMPLETED" && isOwnerOrMgr && (
              <button onClick={() => setShowApprove(true)} disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-[13px] font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-60 transition-colors">
                <Check className="w-3.5 h-3.5" /> Approve &amp; Apply
              </button>
            )}
            {["DRAFT", "IN_PROGRESS"].includes(session.status) && isOwnerOrMgr && (
              <button onClick={doCancel} disabled={actionLoading}
                className="flex items-center gap-2 px-3 py-2 border border-red-200 text-red-600 text-[13px] font-semibold rounded-lg hover:bg-red-50 disabled:opacity-60 transition-colors ml-auto">
                <Ban className="w-3.5 h-3.5" /> Cancel Audit
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Keyboard tip ─────────────────────────────────────────────────── */}
      {canEdit && (
        <div className="flex items-center gap-2 text-[12px] text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5">
          <Keyboard className="w-4 h-4 text-slate-400 flex-shrink-0" />
          Press <kbd className="mx-1 px-1.5 py-0.5 bg-white border border-slate-300 rounded text-[11px] font-mono">Enter</kbd>
          to save and jump to the next uncounted item.
          Use <span className="font-bold text-slate-700 mx-0.5">0</span> to mark empty shelves instantly.
          Use <MessageSquare className="w-3.5 h-3.5 inline mx-0.5 text-slate-400" /> to add a note on any discrepancy.
        </div>
      )}

      {/* ── Filter + Search + Zoom all (when approved) ───────────────────── */}
      {!isApproved ? (
        <div className="flex items-center gap-2 flex-wrap">
          {([
            { mode: "all"      , label: "All Items",  count: stats.total          },
            { mode: "uncounted", label: "Uncounted",  count: stats.uncounted      },
            { mode: "variance" , label: "Variance",   count: stats.varianceCount  },
          ] as const).map(({ mode, label, count }) => (
            <button key={mode} onClick={() => setFilterMode(mode as FilterMode)}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg border transition-all",
                filterMode === mode ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300")}>
              {label}
              <span className={cn("text-[11px] font-bold rounded-full px-1.5 leading-[16px]",
                filterMode === mode ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500")}>{count}</span>
            </button>
          ))}
          <div className="flex-1 min-w-[200px] flex items-center border border-slate-200 bg-white rounded-lg px-3 h-9 shadow-sm">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search medicine or batch…"
              className="flex-1 text-[13px] text-slate-700 placeholder-slate-400 bg-transparent focus:outline-none" />
            {search && <button onClick={() => setSearch("")} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-500" />
            <span className="text-[13px] font-semibold text-slate-700">
              {showAllItems ? `All ${session.items.length} items` : `${session.items.filter((i) => i.varianceQty !== null && i.varianceQty !== 0).length} items with variance`}
            </span>
          </div>
          <button onClick={() => setShowAllItems((v) => !v)}
            className="text-[12px] font-semibold text-blue-600 hover:underline">
            {showAllItems ? "Show only variances" : `Show all ${session.items.length} items`}
          </button>
        </div>
      )}

      {/* ── Items: Location-grouped (counting) or flat (approved) ─────────── */}
      {isApproved ? (
        /* Approved: simple flat table */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {approvedDisplayItems!.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <CheckCircle2 className="w-12 h-12 text-emerald-300" />
              <p className="text-[14px] font-semibold text-slate-500">All items matched — no variance</p>
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  {["Medicine", "Batch / Expiry", "Location", "Expected", "Counted", "Variance", "₹ Impact"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {approvedDisplayItems!.map((item) => {
                  const val = Math.abs(item.varianceQty ?? 0) * Number(item.inventory.mrp);
                  return (
                    <tr key={item.id} className={cn("hover:bg-slate-50 transition-colors", (item.varianceQty ?? 0) < 0 && "bg-red-50/20", (item.varianceQty ?? 0) > 0 && "bg-emerald-50/20")}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-800">{item.inventory.medicine.name}</div>
                        {(item.inventory.medicine.form || item.inventory.medicine.strength) && (
                          <div className="text-[11px] text-slate-400">{[item.inventory.medicine.form, item.inventory.medicine.strength].filter(Boolean).join(" ")}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-[12px] text-slate-700">{item.inventory.batchNumber}</div>
                        <div className="text-[11px] text-slate-400">{fmt(item.inventory.expiryDate)}</div>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-slate-500">
                        {item.inventory.shelf ? (
                          <span className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded">{item.inventory.shelf.rack.code}/{item.inventory.shelf.code}</span>
                        ) : item.inventory.location || "—"}
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-slate-700 tabular-nums">{item.expectedQty}</td>
                      <td className="px-4 py-3 text-center font-semibold text-slate-700 tabular-nums">{item.countedQty ?? "—"}</td>
                      <td className="px-4 py-3"><VarianceBadge v={item.varianceQty} /></td>
                      <td className="px-4 py-3">
                        {val > 0 ? (
                          <span className={cn("font-semibold text-[12px]", (item.varianceQty ?? 0) < 0 ? "text-red-600" : "text-emerald-600")}>
                            {(item.varianceQty ?? 0) < 0 ? "-" : "+"}{inr(val)}
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                        {item.notes && <div className="text-[10px] text-slate-400 mt-0.5 italic truncate max-w-[120px]">{item.notes}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
          <FileX className="w-10 h-10 text-slate-200" />
          <p className="text-[14px] font-semibold text-slate-500">No items match this filter</p>
          <button onClick={() => { setFilterMode("all"); setSearch(""); }} className="text-[12px] text-blue-600 font-semibold hover:underline">Clear filters</button>
        </div>
      ) : (
        /* Counting mode: grouped by location */
        <div className="space-y-4">
          {filteredGroups.map((rg) => {
            const rackItems   = rg.shelves.flatMap((sg) => sg.items);
            const rackCounted = rackItems.filter((i) => i.countedQty !== null).length;
            const isUnassigned = rg.rackId === null;

            return (
              <div key={rg.rackId ?? "no-location"} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

                {/* Rack header */}
                <div className={cn("flex items-center gap-3 px-4 py-3 border-b", isUnassigned ? "bg-slate-50 border-slate-200" : "bg-blue-50/60 border-blue-100")}>
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center text-[12px] font-bold flex-shrink-0",
                    isUnassigned ? "bg-slate-200 text-slate-500" : "bg-blue-600 text-white")}>
                    {isUnassigned ? <MapPin className="w-4 h-4" /> : rg.rackCode}
                  </div>
                  <div className="flex-1">
                    <span className="text-[13px] font-bold text-slate-800">{isUnassigned ? "No Location Assigned" : rg.rackName}</span>
                    {!isUnassigned && <span className="ml-2 text-[11px] text-slate-400">({rg.rackCode})</span>}
                  </div>
                  <span className="text-[12px] text-slate-500">
                    {rackCounted === rackItems.length
                      ? <span className="flex items-center gap-1 font-semibold text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" /> All counted</span>
                      : <><span className="font-semibold text-slate-700">{rackCounted}</span>/{rackItems.length}</>}
                  </span>
                </div>

                {rg.shelves.map((sg, sgIdx) => {
                  const uncountedInShelf = sg.items.filter((i) => i.countedQty === null).length;
                  const shelfCounted     = sg.items.length - uncountedInShelf;
                  const shelfDone        = uncountedInShelf === 0;
                  const isLastShelf      = sgIdx === rg.shelves.length - 1;

                  return (
                    <div key={sg.key} className={!isLastShelf ? "border-b border-slate-100" : ""}>

                      {/* Shelf sub-header */}
                      {sg.shelfId && (
                        <div className="flex items-center gap-2 px-4 py-2 bg-slate-50/80 border-b border-slate-100">
                          <Package className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                          <span className="text-[12px] font-semibold text-slate-600">
                            {sg.shelfCode}
                            {sg.shelfLevel !== null && <span className="ml-1.5 text-[11px] font-normal text-slate-400">Level {sg.shelfLevel}</span>}
                          </span>
                          <div className="ml-auto flex items-center gap-2">
                            {/* Per-shelf match all confirm / button */}
                            {canEdit && uncountedInShelf > 0 && (
                              matchConfirmShelf === sg.key ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] text-emerald-700 font-medium">All {uncountedInShelf} match expected?</span>
                                  <button onClick={() => matchShelf(sg.key, sg.items)} disabled={matchingShelf === sg.key}
                                    className="text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-2 py-0.5 rounded-md transition-colors disabled:opacity-60">
                                    {matchingShelf === sg.key ? <Loader2 className="w-3 h-3 animate-spin" /> : "Yes, match all"}
                                  </button>
                                  <button onClick={() => setMatchConfirmShelf(null)} className="text-[11px] text-slate-500 hover:text-slate-700 px-1">No</button>
                                </div>
                              ) : (
                                <button onClick={() => setMatchConfirmShelf(sg.key)}
                                  className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 border border-emerald-200 hover:border-emerald-400 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-0.5 rounded-md transition-colors">
                                  ✓ All Match
                                </button>
                              )
                            )}
                            {/* Per-shelf zero confirm / button */}
                            {canEdit && uncountedInShelf > 0 && (
                              zeroConfirmShelf === sg.key ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] text-amber-700 font-medium">Mark {uncountedInShelf} as 0?</span>
                                  <button onClick={() => zeroShelf(sg.key, sg.items)} disabled={zeroingShelf === sg.key}
                                    className="text-[11px] font-bold text-white bg-amber-500 hover:bg-amber-600 px-2 py-0.5 rounded-md transition-colors disabled:opacity-60">
                                    {zeroingShelf === sg.key ? <Loader2 className="w-3 h-3 animate-spin" /> : "Yes"}
                                  </button>
                                  <button onClick={() => setZeroConfirmShelf(null)} className="text-[11px] text-slate-500 hover:text-slate-700 px-1">No</button>
                                </div>
                              ) : (
                                <button onClick={() => setZeroConfirmShelf(sg.key)}
                                  className="text-[11px] font-semibold text-slate-500 hover:text-amber-600 border border-slate-200 hover:border-amber-300 px-2.5 py-0.5 rounded-md transition-colors">
                                  Zero {uncountedInShelf}
                                </button>
                              )
                            )}
                            {shelfDone
                              ? <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{sg.items.length}/{sg.items.length}</span>
                              : <span className="text-[11px] text-slate-400">{shelfCounted}/{sg.items.length}</span>}
                          </div>
                        </div>
                      )}

                      {/* Items table */}
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr className="border-b border-slate-50 bg-slate-25">
                            <th className="text-left px-4 py-2 font-semibold text-slate-400 text-[11px] uppercase tracking-wide">Medicine</th>
                            <th className="text-left px-4 py-2 font-semibold text-slate-400 text-[11px] uppercase tracking-wide">Batch / Expiry</th>
                            <th className="text-center px-3 py-2 font-semibold text-slate-400 text-[11px] uppercase tracking-wide">Expected</th>
                            <th className="text-center px-3 py-2 font-semibold text-slate-400 text-[11px] uppercase tracking-wide">Counted</th>
                            <th className="text-center px-3 py-2 font-semibold text-slate-400 text-[11px] uppercase tracking-wide w-28">Variance / ₹</th>
                            {canEdit && <th className="px-2 py-2 w-20 text-center text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Quick</th>}
                            <th className="px-2 py-2 w-6" />
                          </tr>
                        </thead>
                        <tbody>
                          {sg.items.map((item) => {
                            const localVal     = counts[item.id] ?? "";
                            const localNum     = localVal !== "" ? parseInt(localVal) : null;
                            const isDirty      = localNum !== null && localNum !== item.countedQty;
                            const previewV     = localNum !== null ? localNum - item.expectedQty : item.varianceQty;
                            const uncounted    = item.countedQty === null;
                            const varVal       = Math.abs(item.varianceQty ?? 0) * Number(item.inventory.mrp);
                            const noteExpanded = expandedNotes.has(item.id);
                            const hasNote      = !!(notesDraft[item.id] ?? item.notes);

                            return (
                              <Fragment key={item.id}>
                                <tr className={cn("transition-colors border-b border-slate-50 last:border-0",
                                  uncounted && canEdit           ? "bg-amber-50/40 hover:bg-amber-50/70" :
                                  item.varianceQty === 0         ? "bg-emerald-50/30 hover:bg-emerald-50/50" :
                                  (item.varianceQty ?? 0) !== 0 && item.countedQty !== null ? "bg-red-50/20 hover:bg-red-50/40" :
                                  "hover:bg-slate-50/60",
                                )}>
                                  {/* Medicine */}
                                  <td className="px-4 py-2.5">
                                    <div className="font-semibold text-slate-800 leading-snug">{item.inventory.medicine.name}</div>
                                    {(item.inventory.medicine.form || item.inventory.medicine.strength) && (
                                      <div className="text-[11px] text-slate-400">{[item.inventory.medicine.form, item.inventory.medicine.strength].filter(Boolean).join(" ")}</div>
                                    )}
                                  </td>

                                  {/* Batch / Expiry */}
                                  <td className="px-4 py-2.5">
                                    <div className="font-mono text-[12px] text-slate-700">{item.inventory.batchNumber}</div>
                                    <div className="text-[11px] text-slate-400">{fmt(item.inventory.expiryDate)}</div>
                                  </td>

                                  {/* Expected */}
                                  <td className="px-3 py-2.5 text-center font-semibold text-slate-700 tabular-nums">{item.expectedQty}</td>

                                  {/* Counted */}
                                  <td className="px-3 py-2.5 text-center">
                                    {canEdit ? (
                                      <div className="flex items-center justify-center gap-1">
                                        <input
                                          ref={(el) => { if (el) inputRefs.current.set(item.id, el); else inputRefs.current.delete(item.id); }}
                                          type="number" min={0} value={localVal}
                                          onChange={(e) => setCounts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                          onBlur={() => { if (isDirty) saveCountValue(item, parseInt(localVal)); }}
                                          onKeyDown={(e) => handleKeyDown(e, item)}
                                          placeholder="—"
                                          className={cn("w-20 text-center border rounded-lg px-2 py-1.5 text-[14px] font-bold focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all tabular-nums",
                                            uncounted ? "border-amber-300 bg-amber-50 text-amber-800 placeholder-amber-400 ring-1 ring-amber-200" : "border-slate-200 text-slate-800",
                                          )}
                                        />
                                        {savingItem === item.id && <Loader2 className="w-3 h-3 text-blue-400 animate-spin flex-shrink-0" />}
                                      </div>
                                    ) : (
                                      <span className={cn("font-semibold tabular-nums", item.countedQty === null ? "text-slate-300" : "text-slate-700")}>
                                        {item.countedQty ?? "—"}
                                      </span>
                                    )}
                                  </td>

                                  {/* Variance + ₹ value */}
                                  <td className="px-3 py-2.5 text-center">
                                    <VarianceBadge v={previewV} preview={isDirty} />
                                    {item.varianceQty !== null && item.varianceQty !== 0 && varVal > 0 && (
                                      <div className={cn("text-[10px] font-semibold mt-0.5", item.varianceQty < 0 ? "text-red-400" : "text-emerald-500")}>
                                        {item.varianceQty < 0 ? "-" : "+"}{inr(varVal)}
                                      </div>
                                    )}
                                  </td>

                                  {/* Quick Match + Quick 0 */}
                                  {canEdit && (
                                    <td className="px-2 py-2.5 text-center">
                                      {uncounted && (
                                        <div className="flex flex-col items-center gap-1">
                                          <button onClick={() => matchItem(item)} disabled={savingItem === item.id} title={`Mark as ${item.expectedQty} (matches expected)`}
                                            className="w-full px-2 py-0.5 rounded-md border border-emerald-200 bg-emerald-50 hover:border-emerald-400 hover:bg-emerald-100 text-[10px] font-bold text-emerald-700 transition-colors disabled:opacity-40 whitespace-nowrap">
                                            ✓ {item.expectedQty}
                                          </button>
                                          <button onClick={() => markAsZero(item)} disabled={savingItem === item.id} title="Mark as 0"
                                            className="w-full px-2 py-0.5 rounded-md border border-slate-200 bg-slate-50 hover:border-amber-300 hover:bg-amber-50 text-[10px] font-bold text-slate-400 hover:text-amber-600 transition-colors disabled:opacity-40">
                                            0
                                          </button>
                                        </div>
                                      )}
                                    </td>
                                  )}

                                  {/* Note toggle */}
                                  <td className="px-2 py-2.5 text-center">
                                    <button onClick={() => toggleNote(item.id)} title={hasNote ? "View/edit note" : "Add note"}
                                      className={cn("w-6 h-6 rounded-md flex items-center justify-center transition-colors",
                                        noteExpanded ? "bg-blue-100 text-blue-600" : hasNote ? "text-blue-400 hover:text-blue-600" : "text-slate-300 hover:text-slate-500",
                                      )}>
                                      <MessageSquare className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                </tr>

                                {/* Expandable note row */}
                                {noteExpanded && (
                                  <tr className="bg-blue-50/40 border-b border-slate-50">
                                    <td colSpan={canEdit ? 7 : 6} className="px-4 py-2">
                                      <div className="flex items-center gap-2">
                                        <MessageSquare className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                                        <input
                                          value={notesDraft[item.id] ?? item.notes ?? ""}
                                          onChange={(e) => canEdit && setNotesDraft((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                          onBlur={() => canEdit && saveNote(item)}
                                          readOnly={!canEdit}
                                          placeholder={canEdit ? "Explain the discrepancy (e.g. found in cold room, packaging damaged, batch split)…" : item.notes ?? "No note"}
                                          className={cn("flex-1 text-[12px] text-slate-700 placeholder-slate-400 border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400",
                                            canEdit ? "bg-white border-blue-200" : "bg-slate-50 border-slate-200 cursor-default text-slate-500"
                                          )}
                                        />
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showApprove && (
          <ApproveModal session={session} onClose={() => setShowApprove(false)} onDone={() => { setShowApprove(false); load(); }} />
        )}
        {showSmartComplete && (
          <SmartCompleteModal
            uncountedCount={stats.uncounted}
            onMarkAndComplete={doMarkAllAndComplete}
            onCancel={() => setShowSmartComplete(false)}
            loading={actionLoading}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
