

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ElementType } from "react";
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus, Lightbulb, RefreshCw, ChevronRight, Search, Calendar,
  ChevronDown, SlidersHorizontal, Loader2, ArrowUpDown,
  ArrowUp, ArrowDown, FileX, AlertCircle, TrendingUp, RotateCcw,
  BadgeIndianRupee, CreditCard, X,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type DashboardStats = {
  todaySales:      number;
  todayCount:      number;
  todayCancelled:  number;
  todayReturns:    number;
  last7DaysSales:  number;
  last7DaysCount:  number;
  monthSales:      number;
  monthCount:      number;
  pendingCredit:   number;
  lowStockCount:   number;
  nearExpiryCount: number;
};

type PaymentStatus = "PAID" | "PENDING" | "PARTIAL";
type PaymentMode   = "CASH" | "UPI" | "CARD" | "CREDIT";

type Invoice = {
  id: string;
  invoiceNumber: string;
  createdAt: string;
  paymentMode: PaymentMode;
  paymentStatus: PaymentStatus;
  totalAmount: number;
  isCancelled: boolean;
  customer: { name: string; phone: string | null } | null;
  user: { name: string };
};

type SortCol = "invoiceNumber" | "createdAt" | "customerName" | "totalAmount" | "paymentStatus";
type SortDir = "asc" | "desc";
type AmountFilter = "all" | "lte500" | "501-2000" | "2001-5000" | "gt5000";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "2-digit",
  });
}

function fmtCurrency(n: number) {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateInput(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function getCurrentFY() {
  const now = new Date();
  const yr = now.getFullYear();
  const start = now.getMonth() >= 3 ? yr : yr - 1;
  return {
    from:  `${start}-04-01`,
    to:    `${start + 1}-03-31`,
    label: `01/04/${start} - 31/03/${start + 1}`,
  };
}

// Computed once at module load — FY doesn't change within a browser session
const CURRENT_FY = getCurrentFY();

type StatConfig = {
  label:     string;
  Icon:      ElementType;
  iconCls:   string;
  accent:    string;
  getValue:  (s: DashboardStats) => string;
  getSub:    (s: DashboardStats) => string | null;
};

const STAT_CONFIGS: StatConfig[] = [
  {
    label:    "Today's Sales",
    Icon:     TrendingUp,
    iconCls:  "text-blue-500",
    accent:   "text-blue-700",
    getValue: (s) => fmtCurrency(s.todaySales),
    getSub:   (s) => `${s.todayCount} bill${s.todayCount !== 1 ? "s" : ""}`,
  },
  {
    label:    "Last 7 Days",
    Icon:     BadgeIndianRupee,
    iconCls:  "text-indigo-500",
    accent:   "text-indigo-700",
    getValue: (s) => fmtCurrency(s.last7DaysSales),
    getSub:   (s) => `${s.last7DaysCount} bills`,
  },
  {
    label:    "This Month",
    Icon:     BadgeIndianRupee,
    iconCls:  "text-violet-500",
    accent:   "text-violet-700",
    getValue: (s) => fmtCurrency(s.monthSales),
    getSub:   (s) => `${s.monthCount} bills`,
  },
  {
    label:    "Today's Returns",
    Icon:     RotateCcw,
    iconCls:  "text-orange-400",
    accent:   "text-orange-600",
    getValue: (s) => fmtCurrency(s.todayReturns),
    getSub:   () => null,
  },
  {
    label:    "Credit Pending",
    Icon:     CreditCard,
    iconCls:  "text-red-400",
    accent:   "text-red-600",
    getValue: (s) => fmtCurrency(s.pendingCredit),
    getSub:   () => null,
  },
];

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  PAID:      { label: "Paid",      cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  PENDING:   { label: "Pending",   cls: "bg-amber-50   text-amber-700   border-amber-200"   },
  PARTIAL:   { label: "Partial",   cls: "bg-orange-50  text-orange-700  border-orange-200"  },
  CANCELLED: { label: "Cancelled", cls: "bg-red-50     text-red-600     border-red-200"     },
};

function StatusBadge({ isCancelled, paymentStatus }: { isCancelled: boolean; paymentStatus: string }) {
  const key = isCancelled ? "CANCELLED" : paymentStatus;
  const { label, cls } = STATUS_CFG[key] ?? { label: paymentStatus, cls: "bg-slate-50 text-slate-600 border-slate-200" };
  return (
    <span className={cn("inline-flex items-center text-[11px] font-semibold border rounded-full px-2 py-0.5 whitespace-nowrap", cls)}>
      {label}
    </span>
  );
}

// ─── Sort icon ────────────────────────────────────────────────────────────────

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-blue-400 transition-colors" />;
  return dir === "asc"
    ? <ArrowUp   className="w-3 h-3 text-blue-600" />
    : <ArrowDown className="w-3 h-3 text-blue-600" />;
}

// ─── Amount filter labels ─────────────────────────────────────────────────────

const AMOUNT_OPTIONS: [AmountFilter, string][] = [
  ["all",      "All"],
  ["lte500",   "Up to ₹500"],
  ["501-2000", "₹501 – ₹2,000"],
  ["2001-5000","₹2,001 – ₹5,000"],
  ["gt5000",   "Above ₹5,000"],
];

const AMOUNT_SHORT: Record<AmountFilter, string> = {
  "all":       "All",
  "lte500":    "≤ ₹500",
  "501-2000":  "₹501–2K",
  "2001-5000": "₹2K–5K",
  "gt5000":    "> ₹5K",
};

function applyAmountFilter(inv: Invoice, filter: AmountFilter) {
  const a = inv.totalAmount;
  if (filter === "lte500")    return a <= 500;
  if (filter === "501-2000")  return a > 500  && a <= 2000;
  if (filter === "2001-5000") return a > 2000 && a <= 5000;
  if (filter === "gt5000")    return a > 5000;
  return true;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BillingDashboardPage() {
  const navigate = useNavigate();
  const fy = CURRENT_FY;

  // ── Stats state ───────────────────────────────────────────────
  const [stats,        setStats]        = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    api.get("/billing/dashboard/stats")
      .then(({ data }) => setStats(data.data))
      .catch(() => {/* non-critical */})
      .finally(() => setStatsLoading(false));
  }, []);

  // ── Data state ────────────────────────────────────────────────
  const [invoices,   setInvoices]   = useState<Invoice[]>([]);
  const [total,      setTotal]      = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page,       setPage]       = useState(1);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  // ── Filter state ──────────────────────────────────────────────
  const [billSearch,    setBillSearch]    = useState("");
  const [nameSearch,    setNameSearch]    = useState("");
  const [dateFrom,      setDateFrom]      = useState(fy.from);
  const [dateTo,        setDateTo]        = useState(fy.to);
  const [dateLabel,     setDateLabel]     = useState(fy.label);
  const [amountFilter,  setAmountFilter]  = useState<AmountFilter>("all");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showAmountDrop, setShowAmountDrop] = useState(false);
  const [draftFrom,     setDraftFrom]     = useState(fy.from);
  const [draftTo,       setDraftTo]       = useState(fy.to);

  // ── Sort state ────────────────────────────────────────────────
  const [sortCol, setSortCol] = useState<SortCol>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // ── Refs for outside-click ────────────────────────────────────
  const dateRef   = useRef<HTMLDivElement>(null);
  const amountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (dateRef.current   && !dateRef.current.contains(e.target as Node))   setShowDatePicker(false);
      if (amountRef.current && !amountRef.current.contains(e.target as Node)) setShowAmountDrop(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  // ── Fetch ─────────────────────────────────────────────────────
  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const search = billSearch.trim() || nameSearch.trim() || undefined;
      const { data } = await api.get("/billing", {
        params: {
          page,
          limit: 20,
          ...(search ? { search } : {}),
          from: dateFrom,
          to:   dateTo,
          includeCancelled: true,
        },
      });
      setInvoices(data.data.items);
      setTotal(data.data.total);
      setTotalPages(data.data.totalPages);
    } catch {
      setError("Failed to load invoices. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [page, billSearch, nameSearch, dateFrom, dateTo]);

  // Debounce search; fetch immediately on non-text param change
  useEffect(() => {
    const delay = billSearch || nameSearch ? 380 : 0;
    const t = setTimeout(fetchInvoices, delay);
    return () => clearTimeout(t);
  }, [fetchInvoices]);

  // ── Client-side sort + amount filter ─────────────────────────
  const displayedInvoices = useMemo(() => {
    const filtered = invoices.filter((inv) => applyAmountFilter(inv, amountFilter));

    return [...filtered].sort((a, b) => {
      let va: string | number;
      let vb: string | number;

      switch (sortCol) {
        case "invoiceNumber":
          va = a.invoiceNumber; vb = b.invoiceNumber; break;
        case "createdAt":
          va = a.createdAt; vb = b.createdAt; break;
        case "customerName":
          va = a.customer?.name ?? ""; vb = b.customer?.name ?? ""; break;
        case "totalAmount":
          va = a.totalAmount; vb = b.totalAmount; break;
        case "paymentStatus":
          va = a.isCancelled ? "CANCELLED" : a.paymentStatus;
          vb = b.isCancelled ? "CANCELLED" : b.paymentStatus;
          break;
        default:
          return 0;
      }

      if (va < vb) return sortDir === "asc" ? -1 :  1;
      if (va > vb) return sortDir === "asc" ?  1 : -1;
      return 0;
    });
  }, [invoices, amountFilter, sortCol, sortDir]);

  function handleSort(col: SortCol) {
    setSortDir((d) => col === sortCol ? (d === "asc" ? "desc" : "asc") : "desc");
    setSortCol(col);
  }

  function applyDateRange() {
    const fmt = (iso: string) => {
      const d = new Date(iso);
      return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    };
    setDateFrom(draftFrom);
    setDateTo(draftTo);
    setDateLabel(`${fmt(draftFrom)} - ${fmt(draftTo)}`);
    setPage(1);
    setShowDatePicker(false);
  }

  function resetDateToFY() {
    setDraftFrom(fy.from);
    setDraftTo(fy.to);
    setDateFrom(fy.from);
    setDateTo(fy.to);
    setDateLabel(fy.label);
    setPage(1);
    setShowDatePicker(false);
  }

  const activeFilterCount =
    (billSearch ? 1 : 0) + (nameSearch ? 1 : 0) + (amountFilter !== "all" ? 1 : 0);

  // ── Table column header ───────────────────────────────────────
  function ColHeader({
    col,
    label,
    sortable = true,
    className,
  }: { col?: SortCol; label: string; sortable?: boolean; className?: string }) {
    if (!sortable || !col) {
      return (
        <th className={cn("px-4 py-3 text-left text-[12px] font-semibold text-blue-600 whitespace-nowrap", className)}>
          {label}
        </th>
      );
    }
    return (
      <th className={cn("px-4 py-3 text-left whitespace-nowrap", className)}>
        <button
          onClick={() => handleSort(col)}
          className="flex items-center gap-1 text-[12px] font-semibold text-blue-600 group hover:text-blue-700 transition-colors"
        >
          {label}
          <SortIcon active={sortCol === col} dir={sortDir} />
        </button>
      </th>
    );
  }

  // ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">

      {/* ── Header bar ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 border-b border-slate-200 flex-shrink-0" style={{ height: "52px" }}>
        <div className="flex items-center gap-3">
          <h1 className="text-[18px] font-bold text-slate-900 leading-none">Sales</h1>

          <Link
            to="/dashboard/billing/new"
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-[13px] font-semibold px-3 py-1.5 rounded-md transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
            New
          </Link>

          <button className="w-6 h-6 rounded-full bg-yellow-400 hover:bg-yellow-500 flex items-center justify-center transition-colors shadow-sm">
            <Lightbulb className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
          </button>
        </div>

        <Link
          to="/dashboard/billing/returns"
          className="flex items-center gap-1.5 text-blue-600 hover:text-blue-700 text-[13px] font-medium transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Sales Return
          <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* ── Stats banner ────────────────────────────────────────── */}
      <div className="flex items-stretch gap-0 border-b border-slate-200 bg-slate-50 flex-shrink-0 divide-x divide-slate-200">
        {STAT_CONFIGS.map(({ label, Icon, iconCls, accent, getValue, getSub }) => {
          const value = stats ? getValue(stats) : "—";
          const sub   = stats ? getSub(stats)   : null;
          return (
            <div key={label} className="flex-1 flex items-center gap-2 px-4 py-2.5 min-w-0">
              <Icon className={cn("w-3.5 h-3.5 flex-shrink-0", iconCls)} aria-hidden />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">{label}</p>
                {statsLoading ? (
                  <div className="h-4 w-16 bg-slate-200 animate-pulse rounded mt-0.5" />
                ) : (
                  <p className={cn("text-[15px] font-bold leading-tight whitespace-nowrap", accent)}>{value}</p>
                )}
                {sub && !statsLoading && (
                  <p className="text-[10px] text-slate-400 leading-tight">{sub}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Filter toolbar ──────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-[#f7f9fc] flex-shrink-0 flex-wrap">

        {/* Bill No. search */}
        <div className="flex items-center border border-slate-200 rounded-md bg-white overflow-hidden h-[30px] text-[13px] shadow-sm">
          <div className="flex items-center gap-0.5 px-2.5 border-r border-slate-200 text-slate-700 font-medium whitespace-nowrap h-full bg-slate-50">
            <span>Bill No.</span>
            <ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
          </div>
          <input
            type="text"
            value={billSearch}
            onChange={(e) => { setBillSearch(e.target.value); setPage(1); }}
            placeholder="Type Here..."
            className="px-2.5 bg-transparent text-slate-700 placeholder-slate-400 focus:outline-none w-32 h-full text-[13px]"
          />
          <span className="px-2 text-slate-400 flex items-center h-full">
            <Search className="w-3.5 h-3.5" />
          </span>
        </div>

        {/* Date range picker */}
        <div ref={dateRef} className="relative">
          <button
            onClick={() => { setDraftFrom(dateFrom); setDraftTo(dateTo); setShowDatePicker((v) => !v); }}
            className={cn(
              "flex items-center gap-1.5 border rounded-md bg-white px-3 h-[30px] text-[13px] text-slate-700 font-medium hover:border-slate-300 transition-colors whitespace-nowrap shadow-sm",
              showDatePicker ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"
            )}
          >
            <span>{dateLabel}</span>
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
          </button>

          <AnimatePresence>
            {showDatePicker && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0,  scale: 1    }}
                exit={{   opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full left-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-20 p-4 w-[280px]"
              >
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-3">Date Range</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-[11px] text-slate-500 font-medium mb-1 block">From</label>
                    <input
                      type="date"
                      value={draftFrom}
                      onChange={(e) => setDraftFrom(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 font-medium mb-1 block">To</label>
                    <input
                      type="date"
                      value={draftTo}
                      onChange={(e) => setDraftTo(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
                    />
                  </div>
                </div>
                <div className="flex gap-2 justify-end pt-1 border-t border-slate-100">
                  <button
                    onClick={resetDateToFY}
                    className="text-[12px] text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    Reset to FY
                  </button>
                  <button
                    onClick={applyDateRange}
                    className="text-[12px] bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-1.5 rounded-lg transition-colors"
                  >
                    Apply
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Name / Mobile search */}
        <div className="flex items-center border border-slate-200 rounded-md bg-white overflow-hidden h-[30px] text-[13px] shadow-sm">
          <input
            type="text"
            value={nameSearch}
            onChange={(e) => { setNameSearch(e.target.value); setPage(1); }}
            placeholder="Name / Mobile"
            className="px-2.5 bg-transparent text-slate-700 placeholder-slate-400 focus:outline-none w-36 h-full"
          />
          <span className="px-2 text-slate-400 flex items-center h-full">
            <Search className="w-3.5 h-3.5" />
          </span>
        </div>

        {/* Amount filter */}
        <div ref={amountRef} className="relative">
          <button
            onClick={() => setShowAmountDrop((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 border rounded-md bg-white px-3 h-[30px] text-[13px] font-medium transition-colors whitespace-nowrap shadow-sm",
              amountFilter !== "all" ? "border-blue-300 text-blue-600 ring-2 ring-blue-100" : "border-slate-200 text-slate-700 hover:border-slate-300"
            )}
          >
            <span className="text-slate-500 font-semibold">₹</span>
            {AMOUNT_SHORT[amountFilter]}
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>
          <AnimatePresence>
            {showAmountDrop && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0,  scale: 1    }}
                exit={{   opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.14 }}
                className="absolute top-full left-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-20 py-1 min-w-[160px]"
              >
                {AMOUNT_OPTIONS.map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => { setAmountFilter(val); setShowAmountDrop(false); }}
                    className={cn(
                      "w-full text-left px-4 py-2 text-[13px] hover:bg-blue-50 transition-colors",
                      amountFilter === val && "text-blue-600 font-semibold bg-blue-50/60"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Active filter count badge */}
        {activeFilterCount > 0 && (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5">
            <SlidersHorizontal className="w-3 h-3" />
            {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""} active
          </span>
        )}
      </div>

      {/* ── Active filter chips ─────────────────────────────────── */}
      {activeFilterCount > 0 && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-slate-100 bg-blue-50/40 flex-shrink-0 flex-wrap">
          <span className="text-[11px] font-semibold text-slate-400 mr-1">Filters:</span>

          {billSearch && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-white border border-blue-200 text-blue-700 rounded-full px-2.5 py-0.5">
              Bill No.: <span className="font-bold">{billSearch}</span>
              <button onClick={() => { setBillSearch(""); setPage(1); }} className="ml-0.5 hover:text-red-500 transition-colors">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {nameSearch && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-white border border-blue-200 text-blue-700 rounded-full px-2.5 py-0.5">
              Name: <span className="font-bold">{nameSearch}</span>
              <button onClick={() => { setNameSearch(""); setPage(1); }} className="ml-0.5 hover:text-red-500 transition-colors">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {amountFilter !== "all" && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-white border border-blue-200 text-blue-700 rounded-full px-2.5 py-0.5">
              Amount: <span className="font-bold">{AMOUNT_SHORT[amountFilter]}</span>
              <button onClick={() => { setAmountFilter("all"); setPage(1); }} className="ml-0.5 hover:text-red-500 transition-colors">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          <button
            onClick={() => { setBillSearch(""); setNameSearch(""); setAmountFilter("all"); setPage(1); }}
            className="text-[11px] font-semibold text-red-500 hover:text-red-600 ml-auto transition-colors"
          >
            Clear all
          </button>
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-slate-200">
              <ColHeader col="invoiceNumber" label="Bill No."     />
              <ColHeader col="createdAt"     label="Entry Date"   />
              <ColHeader                     label="Bill Date"  sortable={false} />
              <ColHeader                     label="Entry By"   sortable={false} />
              <ColHeader col="customerName"  label="Patient"      />
              <ColHeader                     label="Mobile"     sortable={false} />
              <ColHeader col="totalAmount"   label="Bill Amount"  />
              <ColHeader col="paymentStatus" label="Status"       />
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-24 text-center">
                  <Loader2 className="w-7 h-7 animate-spin text-blue-400 mx-auto" />
                  <p className="text-slate-400 text-[13px] mt-3">Loading invoices…</p>
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={8} className="py-24 text-center">
                  <AlertCircle className="w-8 h-8 text-red-300 mx-auto mb-3" />
                  <p className="text-red-500 text-[13px] font-medium">{error}</p>
                  <button
                    onClick={fetchInvoices}
                    className="mt-3 text-blue-600 text-[12px] hover:underline"
                  >
                    Try again
                  </button>
                </td>
              </tr>
            ) : displayedInvoices.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-24 text-center">
                  <FileX className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-500 text-[14px] font-medium">No invoices found</p>
                  <p className="text-slate-400 text-[12px] mt-1">
                    Try adjusting filters or{" "}
                    <Link to="/dashboard/billing/new" className="text-blue-600 hover:underline font-medium">
                      create a new bill
                    </Link>
                  </p>
                </td>
              </tr>
            ) : (
              displayedInvoices.map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() => navigate(`/dashboard/billing/${inv.id}`)}
                  className="border-b border-slate-100 hover:bg-blue-50/40 cursor-pointer transition-colors group"
                >
                  <td className="px-4 py-3 text-[13px] font-semibold text-blue-600 whitespace-nowrap group-hover:text-blue-700">
                    {inv.invoiceNumber}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap">
                    {formatDate(inv.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap">
                    {formatDate(inv.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-slate-700 whitespace-nowrap">
                    {inv.user.name}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-slate-700 max-w-[140px] truncate">
                    {inv.customer?.name ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">
                    {inv.customer?.phone ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-[13px] font-semibold text-slate-900 whitespace-nowrap tabular-nums">
                    {fmtCurrency(inv.totalAmount)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge isCancelled={inv.isCancelled} paymentStatus={inv.paymentStatus} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ─────────────────────────────────────────── */}
      {!loading && total > 0 && (
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-100 bg-slate-50/60 flex-shrink-0"
        >
            <span className="text-[12px] text-slate-500">
              Showing{" "}
              <span className="font-semibold text-slate-700">
                {Math.min((page - 1) * 20 + 1, total)}–{Math.min(page * 20, total)}
              </span>{" "}
              of{" "}
              <span className="font-semibold text-slate-700">{total}</span> bills
            </span>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] text-slate-600 font-medium hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ‹ Prev
              </button>

              <span className="text-[12px] text-slate-500 font-medium px-3 py-1 bg-white border border-slate-200 rounded-lg">
                {page} / {totalPages}
              </span>

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] text-slate-600 font-medium hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next ›
              </button>
            </div>
        </div>
      )}
    </div>
  );
}
