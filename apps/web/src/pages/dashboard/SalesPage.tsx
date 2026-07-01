
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import type { ElementType } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { useQuery, keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Receipt, FileText, BookmarkCheck, RotateCcw,
  Search, Calendar, ChevronDown, SlidersHorizontal, Loader2,
  ArrowUpDown, ArrowUp, ArrowDown, FileX, AlertCircle, TrendingUp,
  BadgeIndianRupee, CreditCard, X, Banknote, Smartphone, Clock3,
  Package, RefreshCw, Trash2, Play, Clock, IndianRupee,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { TableSkeletonRows } from "@/components/Skeleton";
import { cn } from "@/lib/utils";
import { listDrafts, deleteDraft, clearAllDrafts } from "@/lib/draftStorage";
import { useBillingStore } from "@/components/billing/useBillingStore";
import type { DraftBill } from "@/lib/draftStorage";

// ─── Tab type ──────────────────────────────────────────────────────────────────

type Tab = "bills" | "drafts" | "returns";

// ─── Shared helpers ────────────────────────────────────────────────────────────

function fmtCurrency(n: number) {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}
function getCurrentFY() {
  const now = new Date(), yr = now.getFullYear(), start = now.getMonth() >= 3 ? yr : yr - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: `01/04/${start} - 31/03/${start + 1}` };
}
const FY = getCurrentFY();

// Debounces a value — decouples input state from query key so keystrokes don't fire requests
function useDebounce<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

type DashboardStats = {
  todaySales: number; todayCount: number; todayCancelled: number;
  todayReturns: number; last7DaysSales: number; last7DaysCount: number;
  monthSales: number; monthCount: number; pendingCredit: number;
  lowStockCount: number; nearExpiryCount: number;
};
type PaymentMode   = "CASH" | "UPI" | "CARD" | "CREDIT";
type PaymentStatus = "PAID" | "PENDING" | "PARTIAL";
type Invoice = {
  id: string; invoiceNumber: string; createdAt: string;
  paymentMode: PaymentMode; paymentStatus: PaymentStatus;
  totalAmount: number; isCancelled: boolean; doctorName: string | null;
  customer: { name: string; phone: string | null } | null;
  user: { name: string }; _count: { items: number };
};
type ReturnRow = {
  id: string; returnNumber: string; createdAt: string; totalAmount: number;
  reason: string | null; invoice: { id: string; invoiceNumber: string };
  customer: { name: string; phone: string | null } | null;
  user: { name: string }; items: { quantity: number; amount: number }[];
};
type SortDir    = "asc" | "desc";
type SortColB   = "invoiceNumber" | "createdAt" | "customerName" | "totalAmount" | "paymentStatus";
type SortColR   = "returnNumber"  | "createdAt" | "totalAmount"  | "customerName";
type AmountFilter = "all" | "lte500" | "501-2000" | "2001-5000" | "gt5000";
type ModeFilter   = "all" | "CASH" | "UPI" | "CARD" | "CREDIT";
type StatusFilter = "all" | "PAID" | "PENDING" | "PARTIAL" | "CANCELLED";

// ─── Constants ─────────────────────────────────────────────────────────────────

const STAT_CFGS: {
  label: string; Icon: ElementType; iconCls: string; accent: string; bg: string;
  getValue: (s: DashboardStats) => string; getSub: (s: DashboardStats) => string | null;
}[] = [
  { label: "Today's Sales",   Icon: TrendingUp,       iconCls: "text-blue-500",   accent: "text-blue-700",   bg: "bg-blue-50/60",   getValue: s => fmtCurrency(s.todaySales),     getSub: s => `${s.todayCount} bill${s.todayCount !== 1 ? "s" : ""}` },
  { label: "Last 7 Days",     Icon: BadgeIndianRupee, iconCls: "text-indigo-500", accent: "text-indigo-700", bg: "bg-indigo-50/60", getValue: s => fmtCurrency(s.last7DaysSales), getSub: s => `${s.last7DaysCount} bills`  },
  { label: "This Month",      Icon: BadgeIndianRupee, iconCls: "text-violet-500", accent: "text-violet-700", bg: "bg-violet-50/60", getValue: s => fmtCurrency(s.monthSales),      getSub: s => `${s.monthCount} bills`     },
  { label: "Today's Returns", Icon: RotateCcw,        iconCls: "text-rose-400",   accent: "text-rose-600",   bg: "bg-rose-50/60",   getValue: s => fmtCurrency(s.todayReturns),   getSub: () => null                       },
  { label: "Credit Pending",  Icon: CreditCard,       iconCls: "text-amber-500",  accent: "text-amber-700",  bg: "bg-amber-50/60",  getValue: s => fmtCurrency(s.pendingCredit),  getSub: () => null                       },
];

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  PAID:      { label: "Paid",      cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  PENDING:   { label: "Pending",   cls: "bg-amber-50   text-amber-700   border-amber-200"   },
  PARTIAL:   { label: "Partial",   cls: "bg-orange-50  text-orange-700  border-orange-200"  },
  CANCELLED: { label: "Cancelled", cls: "bg-red-50     text-red-600     border-red-200"     },
};
const MODE_CFG: Record<PaymentMode, { label: string; cls: string; Icon: ElementType }> = {
  CASH:   { label: "Cash",   cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: Banknote   },
  UPI:    { label: "UPI",    cls: "bg-violet-50  text-violet-700  border-violet-200",  Icon: Smartphone },
  CARD:   { label: "Card",   cls: "bg-blue-50    text-blue-700    border-blue-200",    Icon: CreditCard },
  CREDIT: { label: "Credit", cls: "bg-orange-50  text-orange-700  border-orange-200",  Icon: Clock3     },
};
const AMOUNT_OPTIONS: [AmountFilter, string][] = [["all","All"],["lte500","Up to ₹500"],["501-2000","₹501 – ₹2,000"],["2001-5000","₹2,001 – ₹5,000"],["gt5000","Above ₹5,000"]];
const AMOUNT_SHORT: Record<AmountFilter, string> = { all:"All", lte500:"≤ ₹500", "501-2000":"₹501–2K", "2001-5000":"₹2K–5K", gt5000:"> ₹5K" };
const MODE_OPTIONS:   [ModeFilter,   string][] = [["all","All Modes"],["CASH","Cash"],["UPI","UPI"],["CARD","Card"],["CREDIT","Credit"]];
const STATUS_OPTIONS: [StatusFilter, string][] = [["all","All Status"],["PAID","Paid"],["PARTIAL","Partial"],["PENDING","Pending"],["CANCELLED","Cancelled"]];

// ─── Small shared components ───────────────────────────────────────────────────

function StatusBadge({ isCancelled, paymentStatus }: { isCancelled: boolean; paymentStatus: string }) {
  const key = isCancelled ? "CANCELLED" : paymentStatus;
  const { label, cls } = STATUS_CFG[key] ?? { label: paymentStatus, cls: "bg-slate-50 text-slate-600 border-slate-200" };
  return <span className={cn("inline-flex items-center text-[11px] font-semibold border rounded-full px-2 py-0.5 whitespace-nowrap", cls)}>{label}</span>;
}
function PaymentModeBadge({ mode }: { mode: PaymentMode }) {
  const cfg = MODE_CFG[mode] ?? { label: mode, cls: "bg-slate-50 text-slate-600 border-slate-200", Icon: Banknote };
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold border rounded-full px-2 py-0.5 whitespace-nowrap", cfg.cls)}>
      <cfg.Icon className="w-3 h-3" />{cfg.label}
    </span>
  );
}
function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-blue-400 transition-colors" />;
  return dir === "asc" ? <ArrowUp className="w-3 h-3 text-blue-600" /> : <ArrowDown className="w-3 h-3 text-blue-600" />;
}

function applyAmountFilter(inv: Invoice, f: AmountFilter) {
  const a = inv.totalAmount;
  if (f === "lte500")    return a <= 500;
  if (f === "501-2000")  return a > 500  && a <= 2000;
  if (f === "2001-5000") return a > 2000 && a <= 5000;
  if (f === "gt5000")    return a > 5000;
  return true;
}

// ─── DatePicker dropdown (shared) ─────────────────────────────────────────────

function DateRangePicker({
  dateLabel, dateFrom, dateTo,
  onApply, onReset,
}: {
  dateLabel: string; dateFrom: string; dateTo: string;
  onApply: (from: string, to: string) => void;
  onReset: () => void;
}) {
  const [open,  setOpen]  = useState(false);
  const [dFrom, setDFrom] = useState(dateFrom);
  const [dTo,   setDTo]   = useState(dateTo);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setDFrom(dateFrom); setDTo(dateTo); setOpen(v => !v); }}
        className={cn(
          "flex items-center gap-1.5 border rounded-lg bg-white px-3 h-[30px] text-[13px] text-slate-700 font-medium hover:border-slate-300 transition-colors whitespace-nowrap shadow-sm",
          open ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"
        )}
      >
        <span>{dateLabel}</span><Calendar className="w-3.5 h-3.5 text-slate-400" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }} transition={{ duration: 0.13 }}
            className="absolute top-full left-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-30 p-4 w-[280px]"
          >
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-3">Date Range</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-[11px] text-slate-500 font-medium mb-1 block">From</label>
                <input type="date" value={dFrom} onChange={e => setDFrom(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 font-medium mb-1 block">To</label>
                <input type="date" value={dTo} onChange={e => setDTo(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-1 border-t border-slate-100">
              <button onClick={() => { onReset(); setOpen(false); }} className="text-[12px] text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors">Reset to FY</button>
              <button onClick={() => { onApply(dFrom, dTo); setOpen(false); }} className="text-[12px] bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-1.5 rounded-lg transition-colors">Apply</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── BillsPanel ────────────────────────────────────────────────────────────────

function BillsPanel({ onCount }: { onCount: (n: number) => void }) {
  const navigate = useNavigate();

  // Filter state
  const [billSearch,    setBillSearch]    = useState("");
  const [nameSearch,    setNameSearch]    = useState("");
  const [page,          setPage]          = useState(1);
  const [dateFrom,      setDateFrom]      = useState(FY.from);
  const [dateTo,        setDateTo]        = useState(FY.to);
  const [dateLabel,     setDateLabel]     = useState(FY.label);
  const [amountFilter,  setAmountFilter]  = useState<AmountFilter>("all");
  const [modeFilter,    setModeFilter]    = useState<ModeFilter>("all");
  const [statusFilter,  setStatusFilter]  = useState<StatusFilter>("all");
  const [showAmountDrop,setShowAmountDrop]= useState(false);
  const [showModeDrop,  setShowModeDrop]  = useState(false);
  const [showStatusDrop,setShowStatusDrop]= useState(false);
  const [sortCol,       setSortCol]       = useState<SortColB>("createdAt");
  const [sortDir,       setSortDir]       = useState<SortDir>("desc");

  const amountRef = useRef<HTMLDivElement>(null);
  const modeRef   = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (amountRef.current && !amountRef.current.contains(e.target as Node)) setShowAmountDrop(false);
      if (modeRef.current   && !modeRef.current.contains(e.target as Node))   setShowModeDrop(false);
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) setShowStatusDrop(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  // Debounced search values — only these go into the query key
  const dBill = useDebounce(billSearch, 380);
  const dName = useDebounce(nameSearch, 380);
  useEffect(() => { setPage(1); }, [dBill, dName]);

  // Stats — 30 s stale, shared across all renders (single request)
  const { data: stats, isLoading: statsLoading, isError: statsError } = useQuery({
    queryKey: ["billing", "stats"] as const,
    queryFn: () => api.get("/billing/dashboard/stats").then(r => r.data.data as DashboardStats),
    staleTime: 30_000,
  });

  // Bills list — 60 s stale, keepPreviousData so pagination feels instant
  const listKey = ["billing", "list", { page, dBill, dName, dateFrom, dateTo, modeFilter, statusFilter }] as const;
  const { data, isPending, isFetching, isError, error, refetch } = useQuery({
    queryKey: listKey,
    queryFn: async () => {
      const search = dBill.trim() || dName.trim() || undefined;
      const { data } = await api.get("/billing", {
        params: {
          page, limit: 20,
          ...(search ? { search } : {}),
          from: dateFrom, to: dateTo,
          ...(modeFilter !== "all" ? { paymentMode: modeFilter } : {}),
          ...(statusFilter === "CANCELLED"
            ? { status: "CANCELLED" }
            : statusFilter !== "all"
              ? { paymentStatus: statusFilter, includeCancelled: false }
              : { includeCancelled: true }),
        },
      });
      return data.data as { items: Invoice[]; total: number; totalPages: number };
    },
    staleTime:       60_000,
    placeholderData: keepPreviousData,
  });

  const total      = data?.total    ?? 0;
  const totalPages = data?.totalPages ?? 1;

  // Push count to parent tab badge (stable onCount ref means this never loops)
  useEffect(() => { if (data?.total !== undefined) onCount(data.total); }, [data?.total, onCount]);

  // Client-side amount filter + sort (no round-trip needed)
  const displayedInvoices = useMemo(() => {
    const invoices = data?.items ?? [];
    const filtered = invoices.filter(inv => applyAmountFilter(inv, amountFilter));
    return [...filtered].sort((a, b) => {
      let va: string | number, vb: string | number;
      switch (sortCol) {
        case "invoiceNumber": va = a.invoiceNumber; vb = b.invoiceNumber; break;
        case "createdAt":     va = a.createdAt;     vb = b.createdAt;     break;
        case "customerName":  va = a.customer?.name ?? ""; vb = b.customer?.name ?? ""; break;
        case "totalAmount":   va = a.totalAmount;   vb = b.totalAmount;   break;
        case "paymentStatus": va = a.isCancelled ? "CANCELLED" : a.paymentStatus; vb = b.isCancelled ? "CANCELLED" : b.paymentStatus; break;
        default: return 0;
      }
      return sortDir === "asc" ? (va < vb ? -1 : va > vb ? 1 : 0) : (va > vb ? -1 : va < vb ? 1 : 0);
    });
  }, [data?.items, amountFilter, sortCol, sortDir]);

  function handleSort(col: SortColB) {
    setSortDir(d => col === sortCol ? (d === "asc" ? "desc" : "asc") : "desc");
    setSortCol(col);
  }

  const activeFilterCount =
    (billSearch ? 1 : 0) + (nameSearch ? 1 : 0) +
    (amountFilter !== "all" ? 1 : 0) + (modeFilter !== "all" ? 1 : 0) + (statusFilter !== "all" ? 1 : 0);

  function ColHeader({ col, label, sortable = true, className }: { col?: SortColB; label: string; sortable?: boolean; className?: string }) {
    if (!sortable || !col) return <th className={cn("px-4 py-3 text-left text-[12px] font-semibold text-slate-500 whitespace-nowrap", className)}>{label}</th>;
    return (
      <th className={cn("px-4 py-3 text-left whitespace-nowrap", className)}>
        <button onClick={() => handleSort(col)} className="flex items-center gap-1 text-[12px] font-semibold text-slate-500 group hover:text-blue-600 transition-colors">
          {label}<SortIcon active={sortCol === col} dir={sortDir} />
        </button>
      </th>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

      {/* Stats banner */}
      <div className="flex items-stretch border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex-shrink-0 divide-x divide-slate-100">
        {STAT_CFGS.map(({ label, Icon, iconCls, accent, bg, getValue, getSub }) => (
          <div key={label} className={cn("flex-1 flex items-center gap-2.5 px-4 py-2.5 min-w-0", bg)}>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-white/70 shadow-sm">
              <Icon className={cn("w-3.5 h-3.5", iconCls)} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">{label}</p>
              {statsLoading
                ? <div className="h-4 w-16 bg-slate-200 animate-pulse rounded mt-0.5" />
                : statsError || !stats
                  ? <p className={cn("text-[15px] font-bold leading-tight whitespace-nowrap tabular-nums", accent)}>—</p>
                  : <p className={cn("text-[15px] font-bold leading-tight whitespace-nowrap tabular-nums", accent)}>{getValue(stats)}</p>
              }
              {stats && !statsError && getSub(stats) && <p className="text-[10px] text-slate-400 leading-tight">{getSub(stats)}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Filter toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-[#f7f9fc] flex-shrink-0 flex-wrap">

        <div className="flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden h-[30px] shadow-sm">
          <div className="flex items-center gap-0.5 px-2.5 border-r border-slate-200 text-slate-600 font-medium whitespace-nowrap h-full bg-slate-50 text-[12px]">
            Bill No.<ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
          </div>
          <input type="text" value={billSearch} onChange={e => setBillSearch(e.target.value)}
            placeholder="Type here…" className="px-2.5 bg-transparent text-slate-700 placeholder-slate-400 focus:outline-none w-32 h-full text-[13px]" />
          <span className="px-2 text-slate-400 flex items-center h-full"><Search className="w-3.5 h-3.5" /></span>
        </div>

        <DateRangePicker
          dateLabel={dateLabel} dateFrom={dateFrom} dateTo={dateTo}
          onApply={(from, to) => {
            const fmt = (s: string) => { const d = new Date(s); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; };
            setDateFrom(from); setDateTo(to); setDateLabel(`${fmt(from)} - ${fmt(to)}`); setPage(1);
          }}
          onReset={() => { setDateFrom(FY.from); setDateTo(FY.to); setDateLabel(FY.label); setPage(1); }}
        />

        <div className="flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden h-[30px] shadow-sm">
          <input type="text" value={nameSearch} onChange={e => setNameSearch(e.target.value)}
            placeholder="Name / Mobile" className="px-2.5 bg-transparent text-slate-700 placeholder-slate-400 focus:outline-none w-36 h-full text-[13px]" />
          <span className="px-2 text-slate-400 flex items-center h-full"><Search className="w-3.5 h-3.5" /></span>
        </div>

        {/* Amount */}
        <div ref={amountRef} className="relative">
          <button onClick={() => setShowAmountDrop(v => !v)}
            className={cn("flex items-center gap-1.5 border rounded-lg bg-white px-3 h-[30px] text-[13px] font-medium transition-colors whitespace-nowrap shadow-sm",
              amountFilter !== "all" ? "border-blue-300 text-blue-600 ring-2 ring-blue-100" : "border-slate-200 text-slate-700 hover:border-slate-300")}>
            <span className="text-slate-500 font-semibold">₹</span>{AMOUNT_SHORT[amountFilter]}<ChevronDown className="w-3 h-3 text-slate-400" />
          </button>
          <AnimatePresence>
            {showAmountDrop && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.12 }}
                className="absolute top-full left-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-20 py-1 min-w-[160px]">
                {AMOUNT_OPTIONS.map(([val, label]) => (
                  <button key={val} onClick={() => { setAmountFilter(val); setShowAmountDrop(false); }}
                    className={cn("w-full text-left px-4 py-2 text-[13px] hover:bg-blue-50 transition-colors", amountFilter === val && "text-blue-600 font-semibold bg-blue-50/60")}>
                    {label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Mode */}
        <div ref={modeRef} className="relative">
          <button onClick={() => setShowModeDrop(v => !v)}
            className={cn("flex items-center gap-1.5 border rounded-lg bg-white px-3 h-[30px] text-[13px] font-medium transition-colors whitespace-nowrap shadow-sm",
              modeFilter !== "all" ? "border-violet-300 text-violet-600 ring-2 ring-violet-100" : "border-slate-200 text-slate-700 hover:border-slate-300")}>
            <Banknote className="w-3.5 h-3.5 text-slate-400" />
            {modeFilter === "all" ? "Payment Mode" : MODE_OPTIONS.find(([v]) => v === modeFilter)?.[1]}
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>
          <AnimatePresence>
            {showModeDrop && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.12 }}
                className="absolute top-full left-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-20 py-1 min-w-[150px]">
                {MODE_OPTIONS.map(([val, label]) => {
                  const Icon = val !== "all" ? MODE_CFG[val as PaymentMode]?.Icon : null;
                  return (
                    <button key={val} onClick={() => { setModeFilter(val); setShowModeDrop(false); setPage(1); }}
                      className={cn("w-full text-left px-4 py-2 text-[13px] hover:bg-violet-50 transition-colors flex items-center gap-2", modeFilter === val && "text-violet-600 font-semibold bg-violet-50/60")}>
                      {Icon && <Icon className="w-3.5 h-3.5" />}{label}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Status */}
        <div ref={statusRef} className="relative">
          <button onClick={() => setShowStatusDrop(v => !v)}
            className={cn("flex items-center gap-1.5 border rounded-lg bg-white px-3 h-[30px] text-[13px] font-medium transition-colors whitespace-nowrap shadow-sm",
              statusFilter !== "all" ? "border-blue-300 text-blue-600 ring-2 ring-blue-100" : "border-slate-200 text-slate-700 hover:border-slate-300")}>
            <span className="text-slate-500 text-[12px]">Status</span>
            <span className={statusFilter !== "all" ? "font-semibold" : "text-slate-400"}>
              {STATUS_OPTIONS.find(([v]) => v === statusFilter)?.[1] ?? "All"}
            </span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>
          <AnimatePresence>
            {showStatusDrop && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.12 }}
                className="absolute top-full left-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-20 py-1 min-w-[150px]">
                {STATUS_OPTIONS.map(([val, label]) => (
                  <button key={val} onClick={() => { setStatusFilter(val); setShowStatusDrop(false); setPage(1); }}
                    className={cn("w-full text-left px-4 py-2 text-[13px] hover:bg-blue-50 transition-colors", statusFilter === val && "text-blue-600 font-semibold bg-blue-50/60")}>
                    {label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {activeFilterCount > 0 && (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5">
            <SlidersHorizontal className="w-3 h-3" />{activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""} active
          </span>
        )}
      </div>

      {/* Active filter chips */}
      {activeFilterCount > 0 && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-slate-100 bg-blue-50/30 flex-shrink-0 flex-wrap">
          <span className="text-[11px] font-semibold text-slate-400 mr-1">Filters:</span>
          {billSearch && <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-white border border-blue-200 text-blue-700 rounded-full px-2.5 py-0.5">Bill: <b>{billSearch}</b><button onClick={() => setBillSearch("")}><X className="w-3 h-3 ml-0.5 hover:text-red-500" /></button></span>}
          {nameSearch && <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-white border border-blue-200 text-blue-700 rounded-full px-2.5 py-0.5">Name: <b>{nameSearch}</b><button onClick={() => setNameSearch("")}><X className="w-3 h-3 ml-0.5 hover:text-red-500" /></button></span>}
          {amountFilter !== "all" && <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-white border border-blue-200 text-blue-700 rounded-full px-2.5 py-0.5">₹: <b>{AMOUNT_SHORT[amountFilter]}</b><button onClick={() => setAmountFilter("all")}><X className="w-3 h-3 ml-0.5 hover:text-red-500" /></button></span>}
          {modeFilter !== "all" && <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-white border border-violet-200 text-violet-700 rounded-full px-2.5 py-0.5">Mode: <b>{MODE_OPTIONS.find(([v]) => v === modeFilter)?.[1]}</b><button onClick={() => { setModeFilter("all"); setPage(1); }}><X className="w-3 h-3 ml-0.5 hover:text-red-500" /></button></span>}
          {statusFilter !== "all" && <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-white border border-blue-200 text-blue-700 rounded-full px-2.5 py-0.5">Status: <b>{STATUS_OPTIONS.find(([v]) => v === statusFilter)?.[1]}</b><button onClick={() => { setStatusFilter("all"); setPage(1); }}><X className="w-3 h-3 ml-0.5 hover:text-red-500" /></button></span>}
          <button onClick={() => { setBillSearch(""); setNameSearch(""); setAmountFilter("all"); setModeFilter("all"); setStatusFilter("all"); setPage(1); }} className="text-[11px] font-semibold text-red-500 hover:text-red-600 ml-auto">Clear all</button>
        </div>
      )}

      {/* Thin progress bar: visible only during background refetch (not first load) */}
      <div className={cn("h-0.5 flex-shrink-0 transition-opacity duration-200", isFetching && !isPending ? "opacity-100" : "opacity-0")}>
        <div className="h-full bg-blue-400/60 animate-pulse" />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white z-10 shadow-[0_1px_0_0_rgb(226,232,240)]">
            <tr>
              <ColHeader col="invoiceNumber" label="Bill No."  />
              <ColHeader col="createdAt"     label="Date"      />
              <ColHeader                     label="Entry By"  sortable={false} />
              <ColHeader col="customerName"  label="Patient"   />
              <ColHeader                     label="Mobile"    sortable={false} />
              <ColHeader                     label="Payment"   sortable={false} />
              <ColHeader                     label="Items"     sortable={false} />
              <ColHeader col="totalAmount"   label="Amount"    />
              <ColHeader col="paymentStatus" label="Status"    />
            </tr>
          </thead>
          <tbody>
            {isPending ? (
              <TableSkeletonRows columns={9} />
            ) : isError ? (
              <tr><td colSpan={9} className="py-24 text-center">
                <AlertCircle className="w-8 h-8 text-red-300 mx-auto mb-3" />
                <p className="text-red-500 text-[13px] font-medium">Failed to load bills</p>
                {(error as Error)?.message && (
                  <p className="text-slate-400 text-[12px] mt-1">{(error as Error).message}</p>
                )}
                <button onClick={() => refetch()} className="mt-3 text-blue-600 text-[12px] hover:underline">Try again</button>
              </td></tr>
            ) : displayedInvoices.length === 0 ? (
              <tr><td colSpan={9} className="py-24 text-center">
                <FileX className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-500 text-[14px] font-medium">No bills found</p>
                <p className="text-slate-400 text-[12px] mt-1">Try adjusting your filters</p>
              </td></tr>
            ) : (
              displayedInvoices.map(inv => (
                <tr key={inv.id} onClick={() => navigate(`/dashboard/billing/${inv.id}`)}
                  className="border-b border-slate-100 hover:bg-blue-50/40 cursor-pointer transition-colors group">
                  <td className="px-4 py-3 text-[13px] font-semibold text-blue-600 whitespace-nowrap group-hover:text-blue-700">{inv.invoiceNumber}</td>
                  <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap">{fmtDate(inv.createdAt)}</td>
                  <td className="px-4 py-3 text-[13px] text-slate-700 whitespace-nowrap">{inv.user.name}</td>
                  <td className="px-4 py-3 text-[13px] text-slate-700 max-w-[140px] truncate">{inv.customer?.name ?? <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{inv.customer?.phone ?? <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3"><PaymentModeBadge mode={inv.paymentMode} /></td>
                  <td className="px-4 py-3"><span className="inline-flex items-center gap-1 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5"><Package className="w-3 h-3" />{inv._count.items}</span></td>
                  <td className="px-4 py-3 text-[13px] font-semibold text-slate-900 whitespace-nowrap tabular-nums">{fmtCurrency(inv.totalAmount)}</td>
                  <td className="px-4 py-3"><StatusBadge isCancelled={inv.isCancelled} paymentStatus={inv.paymentStatus} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!isPending && total > 0 && (
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-100 bg-slate-50/60 flex-shrink-0">
          <span className="text-[12px] text-slate-500">
            Showing <span className="font-semibold text-slate-700">{Math.min((page-1)*20+1,total)}–{Math.min(page*20,total)}</span> of <span className="font-semibold text-slate-700">{total}</span> bills
          </span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1} className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] text-slate-600 font-medium hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">‹ Prev</button>
            <span className="text-[12px] text-slate-500 font-medium px-3 py-1 bg-white border border-slate-200 rounded-lg">{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages} className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] text-slate-600 font-medium hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next ›</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DraftsPanel ───────────────────────────────────────────────────────────────

function DraftsPanel({ onCount }: { onCount: (n: number) => void }) {
  const [drafts,   setDrafts]   = useState<DraftBill[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const navigate                = useNavigate();
  const { loadDraft }           = useBillingStore();

  useEffect(() => {
    const d = listDrafts();
    setDrafts(d);
    onCount(d.length);
  }, [onCount]);

  function handleResume(draft: DraftBill) {
    loadDraft(draft.items, draft.meta);
    navigate(`/dashboard/billing/new?draft=${draft.id}`);
  }
  function handleDelete(id: string) {
    deleteDraft(id);
    setDrafts(prev => { const next = prev.filter(d => d.id !== id); onCount(next.length); return next; });
    setDeleting(null);
  }
  function handleClearAll() { clearAllDrafts(); setDrafts([]); onCount(0); setClearing(false); }

  function timeAgo(iso: string) {
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.floor(ms/60000), h = Math.floor(ms/3600000), d = Math.floor(ms/86400000);
    if (m < 1) return "just now"; if (m < 60) return `${m}m ago`; if (h < 24) return `${h}h ago`; return `${d}d ago`;
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-slate-100 bg-[#f7f9fc] flex-shrink-0">
        <div className="flex items-center gap-2">
          <BookmarkCheck className="w-4 h-4 text-amber-500" strokeWidth={1.8} />
          <span className="text-[13px] font-semibold text-slate-700">Saved drafts</span>
          <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">{drafts.length}</span>
        </div>
        {drafts.length > 0 && (
          <button onClick={() => setClearing(true)} className="flex items-center gap-1.5 text-[12px] text-red-400 hover:text-red-600 border border-red-100 hover:border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors">
            <Trash2 className="w-3.5 h-3.5" />Clear All
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {drafts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 pb-16">
            <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mb-4">
              <BookmarkCheck className="w-8 h-8 text-amber-300" strokeWidth={1.4} />
            </div>
            <p className="text-[15px] font-semibold text-slate-500">No draft bills</p>
            <p className="text-[13px] text-slate-400 mt-1.5 text-center max-w-[280px]">In the New Bill screen, choose "Save as Draft" to hold a bill for later.</p>
            <button onClick={() => navigate("/dashboard/billing/new")} className="mt-5 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold transition-colors">
              <Play className="w-3.5 h-3.5" />New Bill
            </button>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-5 py-4 space-y-2">
            <AnimatePresence initial={false}>
              {drafts.map(draft => {
                const draftTotal = draft.items.reduce((s, i) => s + i.amount, 0);
                const itemQty    = draft.items.reduce((s, i) => s + i.quantity, 0);
                return (
                  <motion.div key={draft.id} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 60, height: 0, marginBottom: 0 }} transition={{ duration: 0.18 }}
                    className="bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-amber-200/60 transition-all overflow-hidden">
                    <div className="flex items-center gap-4 px-5 py-4">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                        <BookmarkCheck className="w-5 h-5 text-amber-500" strokeWidth={1.8} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-bold text-slate-800 truncate">{draft.label}</p>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          <span className="flex items-center gap-1 text-[11px] text-slate-400"><Clock className="w-3 h-3" />{timeAgo(draft.savedAt)}</span>
                          <span className="flex items-center gap-1 text-[11px] text-slate-400"><Package className="w-3 h-3" />{draft.items.length} med · {itemQty} units</span>
                          {draft.meta.customerName && (
                            <span className="text-[11px] text-blue-500 font-medium">{draft.meta.customerName}{draft.meta.customerPhone ? ` · ${draft.meta.customerPhone}` : ""}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="flex items-center gap-0.5 text-[16px] font-black text-slate-800">
                          <IndianRupee className="w-3.5 h-3.5 text-slate-500" strokeWidth={2.5} />{draftTotal.toFixed(2)}
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wide">{draft.meta.paymentMode}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <button onClick={() => handleResume(draft)} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.97] text-white text-[13px] font-bold transition-all">
                          <Play className="w-3.5 h-3.5" />Resume
                        </button>
                        <button onClick={() => setDeleting(draft.id)} className="w-8 h-8 rounded-xl border border-slate-200 hover:border-red-200 hover:bg-red-50 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {draft.items.length > 0 && (
                      <div className="px-5 pb-3 flex flex-wrap gap-1.5">
                        {draft.items.slice(0, 5).map(item => (
                          <span key={item.inventoryId} className="inline-flex items-center gap-1 text-[11px] bg-slate-50 border border-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                            {item.medicineName}<span className="text-slate-400">×{item.quantity}</span>
                          </span>
                        ))}
                        {draft.items.length > 5 && <span className="text-[11px] text-slate-400 px-2 py-0.5">+{draft.items.length - 5} more</span>}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleting && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeleting(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-sm w-full text-center">
              <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4"><AlertCircle className="w-6 h-6 text-red-500" /></div>
              <h3 className="text-[15px] font-bold text-slate-800 mb-1">Delete Draft?</h3>
              <p className="text-[13px] text-slate-500 mb-5">This draft will be permanently removed.</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleting(null)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
                <button onClick={() => handleDelete(deleting)} className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-[13px] font-bold">Delete</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Clear all confirm */}
      <AnimatePresence>
        {clearing && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setClearing(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-sm w-full text-center">
              <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4"><Trash2 className="w-6 h-6 text-red-500" /></div>
              <h3 className="text-[15px] font-bold text-slate-800 mb-1">Clear All Drafts?</h3>
              <p className="text-[13px] text-slate-500 mb-5">All {drafts.length} draft{drafts.length !== 1 ? "s" : ""} will be permanently deleted.</p>
              <div className="flex gap-3">
                <button onClick={() => setClearing(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
                <button onClick={handleClearAll} className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-[13px] font-bold">Clear All</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── ReturnsPanel ──────────────────────────────────────────────────────────────

function ReturnsPanel({ onCount }: { onCount: (n: number) => void }) {
  const navigate = useNavigate();

  const [search,    setSearch]    = useState("");
  const [page,      setPage]      = useState(1);
  const [dateFrom,  setDateFrom]  = useState(FY.from);
  const [dateTo,    setDateTo]    = useState(FY.to);
  const [dateLabel, setDateLabel] = useState(FY.label);
  const [sortCol,   setSortCol]   = useState<SortColR>("createdAt");
  const [sortDir,   setSortDir]   = useState<SortDir>("desc");

  const dSearch = useDebounce(search, 380);
  useEffect(() => { setPage(1); }, [dSearch]);

  const listKey = ["billing", "returns", { page, dSearch, dateFrom, dateTo }] as const;
  const { data, isPending, isFetching, isError, error, refetch } = useQuery({
    queryKey: listKey,
    queryFn: async () => {
      const { data } = await api.get("/billing/returns", {
        params: { page, limit: 20, search: dSearch || undefined, from: dateFrom, to: dateTo },
      });
      return data.data as { items: ReturnRow[]; total: number; totalPages: number };
    },
    staleTime:       60_000,
    placeholderData: keepPreviousData,
  });

  const total      = data?.total    ?? 0;
  const totalPages = data?.totalPages ?? 1;

  useEffect(() => { if (data?.total !== undefined) onCount(data.total); }, [data?.total, onCount]);

  const displayed = useMemo(() => {
    const rows = data?.items ?? [];
    return [...rows].sort((a, b) => {
      let va: string | number, vb: string | number;
      switch (sortCol) {
        case "returnNumber": va = a.returnNumber; vb = b.returnNumber; break;
        case "createdAt":    va = a.createdAt;    vb = b.createdAt;    break;
        case "customerName": va = a.customer?.name ?? ""; vb = b.customer?.name ?? ""; break;
        case "totalAmount":  va = a.totalAmount;  vb = b.totalAmount;  break;
        default: return 0;
      }
      return sortDir === "asc" ? (va < vb ? -1 : va > vb ? 1 : 0) : (va > vb ? -1 : va < vb ? 1 : 0);
    });
  }, [data?.items, sortCol, sortDir]);

  function handleSort(col: SortColR) {
    setSortDir(d => col === sortCol ? (d === "asc" ? "desc" : "asc") : "desc");
    setSortCol(col);
  }

  function ColHdr({ col, label, sortable = true, className }: { col?: SortColR; label: string; sortable?: boolean; className?: string }) {
    if (!sortable || !col) return <th className={cn("px-4 py-3 text-left text-[12px] font-semibold text-slate-500 whitespace-nowrap", className)}>{label}</th>;
    return (
      <th className={cn("px-4 py-3 text-left whitespace-nowrap", className)}>
        <button onClick={() => handleSort(col)} className="flex items-center gap-1 text-[12px] font-semibold text-slate-500 group hover:text-blue-600 transition-colors">
          {label}<SortIcon active={sortCol === col} dir={sortDir} />
        </button>
      </th>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-[#f7f9fc] flex-shrink-0 flex-wrap">
        <div className="flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden h-[30px] shadow-sm">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Return No. / Invoice / Customer"
            className="px-2.5 bg-transparent text-slate-700 placeholder-slate-400 focus:outline-none w-56 h-full text-[13px]" />
          <span className="px-2 text-slate-400 flex items-center h-full"><Search className="w-3.5 h-3.5" /></span>
        </div>
        <DateRangePicker
          dateLabel={dateLabel} dateFrom={dateFrom} dateTo={dateTo}
          onApply={(from, to) => {
            const fmt = (s: string) => { const d = new Date(s); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; };
            setDateFrom(from); setDateTo(to); setDateLabel(`${fmt(from)} - ${fmt(to)}`); setPage(1);
          }}
          onReset={() => { setDateFrom(FY.from); setDateTo(FY.to); setDateLabel(FY.label); setPage(1); }}
        />
        <button onClick={() => refetch()} className="flex items-center gap-1.5 border border-slate-200 bg-white rounded-lg px-3 h-[30px] text-[13px] text-slate-600 hover:text-slate-800 hover:border-slate-300 shadow-sm transition-colors">
          <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />Refresh
        </button>
      </div>

      {/* Thin progress bar */}
      <div className={cn("h-0.5 flex-shrink-0 transition-opacity duration-200", isFetching && !isPending ? "opacity-100" : "opacity-0")}>
        <div className="h-full bg-rose-400/60 animate-pulse" />
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white z-10 shadow-[0_1px_0_0_rgb(226,232,240)]">
            <tr>
              <ColHdr col="returnNumber" label="Return No."  />
              <ColHdr col="createdAt"    label="Date"        />
              <ColHdr                    label="Invoice No." sortable={false} />
              <ColHdr col="customerName" label="Patient"     />
              <ColHdr                    label="Mobile"      sortable={false} />
              <ColHdr                    label="Items"       sortable={false} />
              <ColHdr col="totalAmount"  label="Return Amt." />
              <ColHdr                    label="Reason"      sortable={false} />
              <ColHdr                    label="Entry By"    sortable={false} />
            </tr>
          </thead>
          <tbody>
            {isPending ? (
              <tr><td colSpan={9} className="py-24 text-center">
                <Loader2 className="w-7 h-7 animate-spin text-rose-400 mx-auto" />
                <p className="text-slate-400 text-[13px] mt-3">Loading returns…</p>
              </td></tr>
            ) : isError ? (
              <tr><td colSpan={9} className="py-24 text-center">
                <AlertCircle className="w-8 h-8 text-red-300 mx-auto mb-3" />
                <p className="text-red-500 text-[13px] font-medium">Failed to load returns</p>
                {(error as Error)?.message && (
                  <p className="text-slate-400 text-[12px] mt-1">{(error as Error).message}</p>
                )}
                <button onClick={() => refetch()} className="mt-3 text-blue-600 text-[12px] hover:underline">Try again</button>
              </td></tr>
            ) : displayed.length === 0 ? (
              <tr><td colSpan={9} className="py-24 text-center">
                <RotateCcw className="w-10 h-10 text-slate-200 mx-auto mb-3" strokeWidth={1.2} />
                <p className="text-slate-500 text-[14px] font-medium">No returns found</p>
                <p className="text-slate-400 text-[12px] mt-1">Returns appear here after processing from a bill</p>
              </td></tr>
            ) : (
              displayed.map(row => {
                const totalItems = row.items.reduce((s, it) => s + it.quantity, 0);
                return (
                  <tr key={row.id} onClick={() => navigate(`/dashboard/billing/${row.invoice.id}`)}
                    className="border-b border-slate-100 hover:bg-rose-50/30 cursor-pointer transition-colors group">
                    <td className="px-4 py-3 text-[13px] font-semibold text-rose-600 whitespace-nowrap">{row.returnNumber}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap">{fmtDate(row.createdAt)}</td>
                    <td className="px-4 py-3 text-[13px] font-medium text-blue-600 whitespace-nowrap">
                      <Link to={`/dashboard/billing/${row.invoice.id}`} onClick={e => e.stopPropagation()} className="hover:underline">{row.invoice.invoiceNumber}</Link>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-slate-700 max-w-[140px] truncate">{row.customer?.name ?? <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{row.customer?.phone ?? <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 tabular-nums text-center">{totalItems}</td>
                    <td className="px-4 py-3 text-[13px] font-semibold text-rose-600 whitespace-nowrap tabular-nums">− {fmtCurrency(row.totalAmount)}</td>
                    <td className="px-4 py-3 text-[12px] text-slate-500 max-w-[160px] truncate italic">{row.reason ?? <span className="text-slate-300 not-italic">—</span>}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap">{row.user.name}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!isPending && total > 0 && (
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-100 bg-slate-50/60 flex-shrink-0">
          <span className="text-[12px] text-slate-500">
            Showing <span className="font-semibold text-slate-700">{Math.min((page-1)*20+1,total)}–{Math.min(page*20,total)}</span> of <span className="font-semibold text-slate-700">{total}</span> returns
          </span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1} className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] text-slate-600 font-medium hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">‹ Prev</button>
            <span className="text-[12px] text-slate-500 font-medium px-3 py-1 bg-white border border-slate-200 rounded-lg">{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages} className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] text-slate-600 font-medium hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next ›</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab config ────────────────────────────────────────────────────────────────

const TAB_CFG: {
  id: Tab; label: string; icon: ElementType;
  activeBg: string; countBg: string; countText: string;
}[] = [
  { id: "bills",   label: "Bills",   icon: FileText,      activeBg: "bg-blue-600",  countBg: "bg-white/25", countText: "text-white" },
  { id: "drafts",  label: "Drafts",  icon: BookmarkCheck, activeBg: "bg-amber-500", countBg: "bg-white/25", countText: "text-white" },
  { id: "returns", label: "Returns", icon: RotateCcw,     activeBg: "bg-rose-500",  countBg: "bg-white/25", countText: "text-white" },
];

// ─── SalesPage ─────────────────────────────────────────────────────────────────

export default function SalesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const rawTab = searchParams.get("tab");
  const tab: Tab = rawTab === "drafts" || rawTab === "returns" ? rawTab : "bills";

  // Track which panels have ever been activated — once mounted they stay mounted (hidden with CSS when inactive)
  const [mounted, setMounted] = useState<Set<Tab>>(() => new Set([tab]));

  // Per-tab count badges — stable callbacks so panels never refetch due to prop change
  const [counts, setCounts] = useState<Partial<Record<Tab, number>>>({ drafts: listDrafts().length });
  const onBillsCount   = useCallback((n: number) => setCounts(p => p.bills   === n ? p : { ...p, bills:   n }), []);
  const onDraftsCount  = useCallback((n: number) => setCounts(p => p.drafts  === n ? p : { ...p, drafts:  n }), []);
  const onReturnsCount = useCallback((n: number) => setCounts(p => p.returns === n ? p : { ...p, returns: n }), []);

  function setTab(t: Tab) {
    if (t === tab) return;
    setMounted(prev => prev.has(t) ? prev : new Set([...prev, t]));
    setSearchParams({ tab: t }, { replace: true });
  }

  // Prefetch the bills list + stats when hovering the Bills tab (if not already in cache)
  function prefetchBills() {
    queryClient.prefetchQuery({
      queryKey: ["billing", "stats"] as const,
      queryFn:  () => api.get("/billing/dashboard/stats").then(r => r.data.data),
      staleTime: 30_000,
    });
    queryClient.prefetchQuery({
      queryKey: ["billing", "list", { page: 1, dBill: "", dName: "", dateFrom: FY.from, dateTo: FY.to, modeFilter: "all", statusFilter: "all" }] as const,
      queryFn:  () => api.get("/billing", { params: { page: 1, limit: 20, from: FY.from, to: FY.to, includeCancelled: true } }).then(r => r.data.data),
      staleTime: 60_000,
    });
  }
  function prefetchReturns() {
    queryClient.prefetchQuery({
      queryKey: ["billing", "returns", { page: 1, dSearch: "", dateFrom: FY.from, dateTo: FY.to }] as const,
      queryFn:  () => api.get("/billing/returns", { params: { page: 1, limit: 20, from: FY.from, to: FY.to } }).then(r => r.data.data),
      staleTime: 60_000,
    });
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 border-b border-slate-200 flex-shrink-0" style={{ height: "52px" }}>

        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg,#0a1a52 0%,#162870 100%)" }}>
            <Receipt className="w-3.5 h-3.5 text-white" strokeWidth={2} />
          </div>
          <span className="text-[17px] font-bold text-slate-900 tracking-tight">Sales</span>
        </div>

        {/* Segmented tab control */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-2xl p-1">
          {TAB_CFG.map(({ id, label, icon: Icon, activeBg, countBg, countText }) => {
            const active = tab === id;
            const count  = counts[id];
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                onMouseEnter={() => {
                  if (!active) {
                    if (id === "bills")   prefetchBills();
                    if (id === "returns") prefetchReturns();
                  }
                }}
                className={cn(
                  "flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold transition-all duration-150 select-none",
                  active
                    ? cn(activeBg, "text-white shadow-md scale-[1.02]")
                    : "text-slate-500 hover:text-slate-700 hover:bg-white/70 hover:shadow-sm"
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" strokeWidth={active ? 2.3 : 1.9} />
                {label}
                {count !== undefined && (
                  <span className={cn(
                    "text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center leading-none",
                    active ? cn(countBg, countText) : "bg-slate-200 text-slate-500"
                  )}>
                    {count > 999 ? "999+" : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="w-[92px]" />
      </div>

      {/* ── Panels — lazy-mount, never unmount, hidden via CSS when inactive ─── */}
      {/*
        Why this pattern:
        - Panels mount once on first visit and stay mounted forever
        - Inactive panels are hidden with `display:none` (zero layout cost)
        - React Query cache means returning to a tab shows data instantly
        - Filter/search/scroll state is fully preserved across tab switches
      */}

      {mounted.has("bills") && (
        <div className={cn("flex flex-col flex-1 min-h-0 overflow-hidden", tab !== "bills" && "hidden")}>
          <BillsPanel onCount={onBillsCount} />
        </div>
      )}
      {mounted.has("drafts") && (
        <div className={cn("flex flex-col flex-1 min-h-0 overflow-hidden", tab !== "drafts" && "hidden")}>
          <DraftsPanel onCount={onDraftsCount} />
        </div>
      )}
      {mounted.has("returns") && (
        <div className={cn("flex flex-col flex-1 min-h-0 overflow-hidden", tab !== "returns" && "hidden")}>
          <ReturnsPanel onCount={onReturnsCount} />
        </div>
      )}
    </div>
  );
}
