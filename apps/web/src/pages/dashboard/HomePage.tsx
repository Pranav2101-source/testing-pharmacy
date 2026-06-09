import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  IndianRupee, Package2, ShoppingCart, AlertTriangle,
  FileText, Users, Clock, ArrowRight, CheckCircle2, XCircle,
  RefreshCw, Loader2, RotateCcw, CreditCard, TrendingUp,
  Plus, ClipboardList, Calendar, FilePlus,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────
type DashboardStats = {
  todaySales:      number;
  todayCount:      number;
  todayCancelled:  number;
  todayReturns:    number;
  weekSales:       number;
  weekCount:       number;
  monthSales:      number;
  monthCount:      number;
  pendingCredit:   number;
  lowStockCount:   number;
  nearExpiryCount: number;
};

type RecentInvoice = {
  id:            string;
  invoiceNumber: string;
  createdAt:     string;
  totalAmount:   number;
  paymentStatus: string;
  isCancelled:   boolean;
  customer:      { name: string } | null;
  _count:        { items: number };
};

type LowStockItem = {
  id:           string;
  quantity:     number;
  minimumStock: number;
  medicine:     { name: string; genericName: string | null };
};

// ─── Helpers ──────────────────────────────────────────────────────
function fmt(n: number) {
  if (n >= 100000) return "₹" + (n / 100000).toFixed(1) + "L";
  if (n >= 1000)   return "₹" + (n / 1000).toFixed(1) + "K";
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0 });
}

function timeAgo(iso: string) {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  if (mins  < 1)  return "just now";
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type StatusCfg = { label: string; dot: string; bg: string; text: string; icon: React.ElementType };
const STATUS_PAID:      StatusCfg = { label: "Paid",      dot: "bg-emerald-500", bg: "bg-emerald-50",  text: "text-emerald-700", icon: CheckCircle2 };
const STATUS_PENDING:   StatusCfg = { label: "Pending",   dot: "bg-amber-500",   bg: "bg-amber-50",    text: "text-amber-700",   icon: Clock        };
const STATUS_PARTIAL:   StatusCfg = { label: "Partial",   dot: "bg-orange-500",  bg: "bg-orange-50",   text: "text-orange-700",  icon: Clock        };
const STATUS_CANCELLED: StatusCfg = { label: "Cancelled", dot: "bg-red-500",     bg: "bg-red-50",      text: "text-red-600",     icon: XCircle      };
const statusConfig: Record<string, StatusCfg> = {
  PAID: STATUS_PAID, PENDING: STATUS_PENDING, PARTIAL: STATUS_PARTIAL, CANCELLED: STATUS_CANCELLED,
};
function getStatus(key: string): StatusCfg { return statusConfig[key] ?? STATUS_PAID; }

const fadeUp = (delay: number) => ({
  initial:    { opacity: 0, y: 10 },
  animate:    { opacity: 1, y: 0  },
  transition: { duration: 0.25, delay },
});

// ─── Stat Card ────────────────────────────────────────────────────
function StatCard({
  label, value, sub, icon: Icon, iconBg, iconColor, accentColor, loading, href,
}: {
  label: string; value: string; sub?: string | null;
  icon: React.ElementType; iconBg: string; iconColor: string; accentColor: string;
  loading: boolean; href?: string;
}) {
  const inner = (
    <div className={cn("stat-card relative overflow-hidden cursor-pointer group", href && "hover:border-blue-200")}>
      <div className={cn("absolute top-0 left-0 w-0.5 h-full rounded-r", accentColor)} />
      <div className="flex items-start justify-between">
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", iconBg)}>
          <Icon className={cn("w-4 h-4", iconColor)} strokeWidth={1.9} />
        </div>
        {href && <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-400 transition-colors" />}
      </div>
      <div className="mt-2">
        {loading ? (
          <div className="h-6 w-20 skeleton rounded mb-1" />
        ) : (
          <p className="text-[22px] font-black text-slate-800 tabnum leading-tight">{value}</p>
        )}
        <p className="text-[11px] font-semibold text-slate-500 mt-0.5 uppercase tracking-wide">{label}</p>
        {sub && !loading && (
          <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>
        )}
      </div>
    </div>
  );

  return href ? <Link to={href}>{inner}</Link> : <div>{inner}</div>;
}

// ─── Page ─────────────────────────────────────────────────────────
export default function DashboardHomePage() {
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const [stats,        setStats]        = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [recentBills,  setRecentBills]  = useState<RecentInvoice[]>([]);
  const [billsLoading, setBillsLoading] = useState(true);
  const [lowStock,     setLowStock]     = useState<LowStockItem[]>([]);
  const [stockLoading, setStockLoading] = useState(true);
  const [refreshKey,   setRefreshKey]   = useState(0);

  useEffect(() => {
    setStatsLoading(true);
    api.get("/billing/dashboard/stats")
      .then(({ data }) => setStats(data.data))
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, [refreshKey]);

  useEffect(() => {
    setBillsLoading(true);
    const s = new Date(); s.setHours(0, 0, 0, 0);
    const e = new Date(); e.setHours(23, 59, 59, 999);
    api.get("/billing", { params: { page: 1, limit: 8, from: s.toISOString(), to: e.toISOString() } })
      .then(({ data }) => setRecentBills(data.data.items ?? []))
      .catch(() => setRecentBills([]))
      .finally(() => setBillsLoading(false));
  }, [refreshKey]);

  useEffect(() => {
    setStockLoading(true);
    api.get("/inventory", { params: { lowStock: true, limit: 6 } })
      .then(({ data }) => setLowStock(data.data.items ?? []))
      .catch(() => setLowStock([]))
      .finally(() => setStockLoading(false));
  }, [refreshKey]);

  const STAT_CARDS = [
    {
      label:       "Today's Sales",
      value:       stats ? fmt(stats.todaySales) : "—",
      sub:         stats ? `${stats.todayCount} bill${stats.todayCount !== 1 ? "s" : ""}` : null,
      icon:        IndianRupee,
      iconBg:      "bg-emerald-50",
      iconColor:   "text-emerald-600",
      accentColor: "bg-emerald-500",
      href:        "/dashboard/billing",
    },
    {
      label:       "This Week",
      value:       stats ? fmt(stats.weekSales) : "—",
      sub:         stats ? `${stats.weekCount} bills` : null,
      icon:        TrendingUp,
      iconBg:      "bg-blue-50",
      iconColor:   "text-blue-600",
      accentColor: "bg-blue-500",
      href:        "/dashboard/billing",
    },
    {
      label:       "This Month",
      value:       stats ? fmt(stats.monthSales) : "—",
      sub:         stats ? `${stats.monthCount} bills` : null,
      icon:        Calendar,
      iconBg:      "bg-indigo-50",
      iconColor:   "text-indigo-600",
      accentColor: "bg-indigo-500",
      href:        "/dashboard/billing",
    },
    {
      label:       "Pending / Credit",
      value:       stats ? fmt(stats.pendingCredit) : "—",
      sub:         null,
      icon:        CreditCard,
      iconBg:      "bg-amber-50",
      iconColor:   "text-amber-600",
      accentColor: "bg-amber-500",
      href:        "/dashboard/billing",
    },
    {
      label:       "Today's Returns",
      value:       stats ? fmt(stats.todayReturns) : "—",
      sub:         null,
      icon:        RotateCcw,
      iconBg:      "bg-rose-50",
      iconColor:   "text-rose-600",
      accentColor: "bg-rose-500",
      href:        "/dashboard/billing/returns",
    },
    {
      label:       "Low Stock Items",
      value:       stats ? String(stats.lowStockCount) : "—",
      sub:         stats && stats.nearExpiryCount > 0 ? `${stats.nearExpiryCount} near expiry` : null,
      icon:        Package2,
      iconBg:      "bg-slate-50",
      iconColor:   "text-slate-600",
      accentColor: "bg-slate-400",
      href:        "/dashboard/inventory",
    },
  ];

  const QUICK_ACTIONS = [
    { href: "/dashboard/billing/new",  label: "New Bill",       icon: FilePlus,     kbd: "F2",  primary: true  },
    { href: "/dashboard/purchase",     label: "Purchase Order", icon: ShoppingCart, kbd: null,  primary: false },
    { href: "/dashboard/inventory",    label: "Check Inventory",icon: Package2,     kbd: null,  primary: false },
    { href: "/dashboard/stock-audit",  label: "Stock Audit",    icon: ClipboardList,kbd: null,  primary: false },
    { href: "/dashboard/billing",      label: "All Bills",      icon: FileText,     kbd: null,  primary: false },
    { href: "/dashboard/reports",      label: "Reports",        icon: TrendingUp,   kbd: null,  primary: false },
  ];

  return (
    <div className="h-full overflow-y-auto bg-slate-50/50">
      <div className="max-w-[1440px] mx-auto px-5 py-5 space-y-5">

        {/* ── Header ──────────────────────────────────────── */}
        <motion.div {...fadeUp(0)} className="flex items-center justify-between">
          <div>
            <h1 className="text-[18px] font-black text-slate-800 leading-tight">Dashboard</h1>
            <p className="text-[12px] text-slate-400 mt-0.5 font-medium">{today}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/dashboard/billing/new")}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[13px] font-bold transition-colors shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
              New Bill
              <kbd className="text-[9px] bg-white/20 text-white/70 rounded px-1 py-0.5 font-mono leading-none">F2</kbd>
            </button>
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              className="flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-blue-600 font-semibold transition-colors border border-slate-200 rounded-lg px-3 py-2 bg-white hover:border-blue-300"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>
        </motion.div>

        {/* ── Quick actions ────────────────────────────────── */}
        <motion.div {...fadeUp(0.04)}>
          <div className="flex flex-wrap gap-2">
            {QUICK_ACTIONS.map(({ href, label, icon: Icon, kbd, primary }) => (
              <Link
                key={href}
                to={href}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all shadow-sm",
                  primary
                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                    : "bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-blue-200"
                )}
              >
                <Icon className="w-3.5 h-3.5" strokeWidth={1.9} />
                {label}
                {kbd && (
                  <kbd className={cn("text-[9px] rounded px-1 py-0.5 font-mono leading-none",
                    primary ? "bg-white/20 text-white/70" : "bg-slate-100 text-slate-400"
                  )}>{kbd}</kbd>
                )}
              </Link>
            ))}
          </div>
        </motion.div>

        {/* ── Stat cards — 3×2 grid ────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {STAT_CARDS.map((s, i) => (
            <motion.div key={s.label} {...fadeUp(0.06 + i * 0.03)}>
              <StatCard {...s} loading={statsLoading} />
            </motion.div>
          ))}
        </div>

        {/* ── Two-column section ───────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

          {/* Today's Bills */}
          <motion.div {...fadeUp(0.22)} className="xl:col-span-2">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">

              {/* Card header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-white">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-blue-50 flex items-center justify-center">
                    <FileText className="w-3.5 h-3.5 text-blue-600" strokeWidth={1.9} />
                  </div>
                  <h2 className="text-[13px] font-black text-slate-800">Today's Bills</h2>
                  {!billsLoading && recentBills.length > 0 && (
                    <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
                      {recentBills.length}
                    </span>
                  )}
                </div>
                <Link to="/dashboard/billing" className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 font-semibold">
                  View all <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              {billsLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-300" />
                </div>
              ) : recentBills.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                  <FileText className="w-8 h-8 text-slate-200 mb-2" strokeWidth={1.4} />
                  <p className="text-[13px] font-medium">No bills today yet</p>
                  <Link to="/dashboard/billing/new" className="text-blue-600 text-[12px] mt-1 hover:underline font-semibold">
                    Create the first one →
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {/* Table head */}
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2 bg-slate-50/60">
                    <span className="ent-table-th text-left rounded-none border-0 py-0 text-[10px]">Customer</span>
                    <span className="ent-table-th rounded-none border-0 py-0 text-[10px]">Bill No.</span>
                    <span className="ent-table-th rounded-none border-0 py-0 text-[10px]">Amount</span>
                    <span className="ent-table-th rounded-none border-0 py-0 text-[10px]">Status</span>
                  </div>
                  {recentBills.map(bill => {
                    const statusKey = bill.isCancelled ? "CANCELLED" : bill.paymentStatus;
                    const s = getStatus(statusKey);
                    const totalQty = bill._count?.items ?? 0;
                    return (
                      <Link
                        key={bill.id}
                        to={`/dashboard/billing/${bill.id}`}
                        className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center px-4 py-2.5 hover:bg-slate-50/60 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-slate-800 truncate leading-tight">
                            {bill.customer?.name ?? "Walk-in"}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {totalQty} item{totalQty !== 1 ? "s" : ""} · {timeAgo(bill.createdAt)}
                          </p>
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono whitespace-nowrap">{bill.invoiceNumber}</span>
                        <span className="text-[13px] font-bold text-slate-800 tabnum whitespace-nowrap">
                          ₹{bill.totalAmount.toLocaleString("en-IN")}
                        </span>
                        <span className={cn("pill whitespace-nowrap", s.bg, s.text)}>
                          <span className={cn("status-dot mr-1", s.dot)} />
                          {s.label}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>

          {/* Low Stock + Near Expiry */}
          <motion.div {...fadeUp(0.26)}>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-full">

              {/* Card header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-white">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-amber-50 flex items-center justify-center">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" strokeWidth={1.9} />
                  </div>
                  <h2 className="text-[13px] font-black text-slate-800">Low Stock</h2>
                  {!stockLoading && lowStock.length > 0 && (
                    <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">
                      {lowStock.length}
                    </span>
                  )}
                </div>
                <Link to="/dashboard/inventory" className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 font-semibold">
                  Inventory <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              {stockLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-300" />
                </div>
              ) : lowStock.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                  <CheckCircle2 className="w-8 h-8 text-emerald-200 mb-2" strokeWidth={1.4} />
                  <p className="text-[13px] font-medium">All stock levels OK</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {lowStock.map(item => {
                    const pct = item.minimumStock > 0
                      ? Math.min(100, Math.round((item.quantity / item.minimumStock) * 100))
                      : 100;
                    return (
                      <div key={item.id} className="px-4 py-3">
                        <div className="flex items-start justify-between mb-1.5">
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold text-slate-800 truncate leading-tight">{item.medicine.name}</p>
                            {item.medicine.genericName && (
                              <p className="text-[10px] text-slate-400 truncate">{item.medicine.genericName}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                            <span className={cn(
                              "text-[11px] font-black tabnum",
                              pct < 25 ? "text-red-600" : pct < 50 ? "text-amber-600" : "text-slate-600"
                            )}>
                              {item.quantity}
                            </span>
                            <span className="text-[10px] text-slate-400">/ {item.minimumStock}</span>
                          </div>
                        </div>
                        <div className="w-full h-1 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={cn("h-full rounded-full transition-all", pct < 25 ? "bg-red-400" : pct < 50 ? "bg-amber-400" : "bg-emerald-400")}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Quick reorder CTA */}
              {!stockLoading && lowStock.length > 0 && (
                <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50">
                  <Link
                    to="/dashboard/purchase"
                    className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg border border-blue-200 text-[12px] font-bold text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" strokeWidth={2} />
                    Create Purchase Order
                  </Link>
                </div>
              )}
            </div>
          </motion.div>

        </div>
      </div>
    </div>
  );
}
