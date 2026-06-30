import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  IndianRupee, Package2, ShoppingCart, AlertTriangle,
  FileText, Clock, ArrowRight, CheckCircle2, XCircle,
  RefreshCw, Loader2, RotateCcw, CreditCard, TrendingUp,
  Plus, ClipboardList, Calendar, FilePlus, Banknote,
  Smartphone, Wallet, Flame, BadgePercent, BarChart2,
  CircleAlert, CalendarClock,
} from "lucide-react";
import { Link, useNavigate, Navigate } from "react-router-dom";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { isSupportStaff, getStoredUser } from "@/lib/auth";

// ─── Types ────────────────────────────────────────────────────────
type PaymentBreakdownItem = { mode: string | null; total: number; count: number };

type DashboardStats = {
  todaySales:       number;
  todayCount:       number;
  todayCancelled:   number;
  todayReturns:     number;
  last7DaysSales:   number;
  last7DaysCount:   number;
  monthSales:       number;
  monthCount:       number;
  pendingCredit:    number;
  lowStockCount:    number;
  nearExpiryCount:  number;
  paymentBreakdown: PaymentBreakdownItem[];
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

type NearExpiryItem = {
  id:          string;
  expiryDate:  string;
  quantity:    number;
  batchNumber: string;
  medicine:    { name: string; genericName: string | null };
};

type EodData = {
  gstCollected:    number;
  topMedicines:    { medicineName: string; genericName: string | null; qtySold: number; revenue: number }[];
  overdueGrnCount: number;
};

type AuditOverview = {
  active:             { id: string; sessionNumber: string; status: string; totalItems: number; countedItems: number } | null;
  needsApproval:      { id: string; sessionNumber: string } | null;
  lastApproved:       { id: string; sessionNumber: string; approvedAt: string } | null;
  daysSinceLastAudit: number | null;
};

// ─── Helpers ──────────────────────────────────────────────────────
function fmt(n: number) {
  if (n >= 100000) return "₹" + (n / 100000).toFixed(1) + "L";
  if (n >= 1000)   return "₹" + (n / 1000).toFixed(1)   + "K";
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0 });
}

function fmtExact(n: number) {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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

function getTimeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// Payment mode visual config
const PAYMENT_MODE_CFG: Record<string, { label: string; bar: string; bg: string; text: string; icon: React.ElementType }> = {
  CASH:   { label: "Cash",   bar: "bg-emerald-500", bg: "bg-emerald-50",  text: "text-emerald-700", icon: Banknote    },
  UPI:    { label: "UPI",    bar: "bg-blue-500",    bg: "bg-blue-50",     text: "text-blue-700",    icon: Smartphone  },
  CARD:   { label: "Card",   bar: "bg-violet-500",  bg: "bg-violet-50",   text: "text-violet-700",  icon: CreditCard  },
  CREDIT: { label: "Credit", bar: "bg-amber-500",   bg: "bg-amber-50",    text: "text-amber-700",   icon: FileText    },
  WALLET: { label: "Wallet", bar: "bg-indigo-500",  bg: "bg-indigo-50",   text: "text-indigo-700",  icon: Wallet      },
};
function getPaymentCfg(mode: string | null) {
  return PAYMENT_MODE_CFG[mode ?? ""] ?? { label: mode ?? "Other", bar: "bg-slate-400", bg: "bg-slate-50", text: "text-slate-600", icon: IndianRupee };
}

// ─── Stat Card ────────────────────────────────────────────────────
const CARD_BG_MAP: Record<string, string> = {
  "bg-emerald-50": "from-emerald-50/60 to-white border-emerald-100/80",
  "bg-blue-50":    "from-blue-50/60 to-white border-blue-100/80",
  "bg-indigo-50":  "from-indigo-50/60 to-white border-indigo-100/80",
  "bg-amber-50":   "from-amber-50/60 to-white border-amber-100/80",
  "bg-violet-50":  "from-violet-50/60 to-white border-violet-100/80",
  "bg-red-50":     "from-red-50/60 to-white border-red-100/80",
  "bg-orange-50":  "from-orange-50/60 to-white border-orange-100/80",
  "bg-slate-50":   "from-slate-50/60 to-white border-slate-200/80",
};

function StatCard({
  label, value, sub, icon: Icon, iconBg, iconColor, loading, href,
}: {
  label: string; value: string; sub?: string | null;
  icon: React.ElementType; iconBg: string; iconColor: string; accentColor: string;
  loading: boolean; href?: string;
}) {
  const cardGradient = CARD_BG_MAP[iconBg] ?? "from-slate-50/60 to-white border-slate-200/80";

  const inner = (
    <div className={cn(
      "relative overflow-hidden rounded-xl border p-4 flex flex-col gap-0 cursor-pointer group",
      "bg-gradient-to-br transition-all duration-200",
      "hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.10)] hover:-translate-y-px",
      cardGradient
    )}>
      {/* Ghost icon watermark */}
      <div className="absolute -right-2 -bottom-2 opacity-[0.07] pointer-events-none select-none" aria-hidden>
        <Icon className="w-16 h-16" strokeWidth={1.2} />
      </div>

      <div className="flex items-start justify-between">
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm ring-1 ring-black/[0.04]", iconBg)}>
          <Icon className={cn("w-[18px] h-[18px]", iconColor)} strokeWidth={2} aria-hidden />
        </div>
        {href && (
          <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:translate-x-0.5 group-hover:text-blue-400 transition-all duration-150 flex-shrink-0 mt-0.5" aria-hidden />
        )}
      </div>

      <div className="mt-3">
        {loading ? (
          <div className="h-7 w-20 skeleton rounded mb-1" />
        ) : (
          <p className="text-[22px] font-black text-slate-800 tabnum leading-tight">{value}</p>
        )}
        <p className="text-[11px] font-semibold text-slate-500 mt-1 uppercase tracking-wide leading-none">{label}</p>
        {sub && !loading && (
          <p className="text-[10px] text-slate-400 mt-1 leading-tight">{sub}</p>
        )}
      </div>
    </div>
  );
  return href ? <Link to={href}>{inner}</Link> : <div>{inner}</div>;
}

// ─── EOD Summary Card ─────────────────────────────────────────────
function EodSummaryCard({
  stats, eodData, loading,
}: {
  stats:   DashboardStats | null;
  eodData: EodData | null;
  loading: boolean;
}) {
  const hasData = stats && stats.todayCount > 0;
  const netRevenue = (stats?.todaySales ?? 0) - (stats?.todayReturns ?? 0);

  // Payment breakdown: sorted by amount desc, compute percentages
  const breakdown = (stats?.paymentBreakdown ?? [])
    .filter(p => (p.total ?? 0) > 0)
    .sort((a, b) => b.total - a.total);
  const breakdownTotal = breakdown.reduce((s, p) => s + p.total, 0);
  const cashAmount = breakdown.find(p => p.mode === "CASH")?.total ?? 0;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-blue-100 flex items-center justify-center">
            <BarChart2 className="w-3.5 h-3.5 text-blue-600" strokeWidth={1.9} />
          </div>
          <h2 className="text-[13px] font-black text-slate-800">Today's Summary</h2>
        </div>
        <Link to="/dashboard/reports" className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 font-semibold">
          Full Report <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-100">
          {[0, 1, 2].map(i => (
            <div key={i} className="p-4 space-y-2">
              <div className="h-4 w-24 skeleton rounded" />
              <div className="h-8 w-32 skeleton rounded" />
              <div className="h-3 w-20 skeleton rounded" />
              <div className="h-3 w-28 skeleton rounded" />
            </div>
          ))}
        </div>
      ) : !hasData ? (
        /* Empty state — no sales yet today */
        <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
          <BarChart2 className="w-10 h-10 text-slate-200" strokeWidth={1.3} />
          <p className="text-[13px] font-semibold text-slate-500">No sales yet today</p>
          <p className="text-[12px] text-slate-400">Summary will appear once you create your first bill.</p>
          <Link
            to="/dashboard/billing/new"
            className="mt-1 flex items-center gap-1.5 text-[12px] font-bold text-blue-600 hover:text-blue-700"
          >
            <FilePlus className="w-3.5 h-3.5" />
            Create a bill
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr_1fr] divide-y md:divide-y-0 md:divide-x divide-slate-100">

          {/* ── Column 1: Revenue ── */}
          <div className="p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <span className="w-5 h-5 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <IndianRupee className="w-3 h-3 text-emerald-600" strokeWidth={2} />
              </span>
              <p className="text-[11px] font-black text-slate-700 uppercase tracking-wide">Revenue</p>
            </div>

            {/* Net Revenue — big hero number */}
            <div className="mb-3">
              <p className="text-[28px] font-black text-slate-800 tabnum leading-none">
                {fmtExact(netRevenue)}
              </p>
              <p className="text-[11px] text-slate-400 font-medium mt-0.5">Net revenue today</p>
            </div>

            {/* Detail rows */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-slate-500">Gross Sales</span>
                <span className="font-semibold text-slate-700 tabnum">{fmtExact(stats?.todaySales ?? 0)}</span>
              </div>
              {(stats?.todayReturns ?? 0) > 0 && (
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-slate-500 flex items-center gap-1">
                    <RotateCcw className="w-3 h-3" /> Returns
                  </span>
                  <span className="font-semibold text-red-600 tabnum">−{fmtExact(stats?.todayReturns ?? 0)}</span>
                </div>
              )}
              {(eodData?.gstCollected ?? 0) > 0 && (
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-slate-500 flex items-center gap-1">
                    <BadgePercent className="w-3 h-3" /> GST Collected
                  </span>
                  <span className="font-semibold text-slate-600 tabnum">{fmtExact(eodData?.gstCollected ?? 0)}</span>
                </div>
              )}
            </div>

            {/* Bill count footer */}
            <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center gap-1.5 text-[11px] text-slate-400">
              <FileText className="w-3 h-3 flex-shrink-0" />
              <span>{stats?.todayCount} bill{stats?.todayCount !== 1 ? "s" : ""}</span>
              {(stats?.todayCancelled ?? 0) > 0 && (
                <>
                  <span className="text-slate-200">·</span>
                  <span className="text-red-400">{stats?.todayCancelled} cancelled</span>
                </>
              )}
            </div>
          </div>

          {/* ── Column 2: Payment Split ── */}
          <div className="p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <span className="w-5 h-5 rounded-md bg-blue-100 flex items-center justify-center flex-shrink-0">
                <CreditCard className="w-3 h-3 text-blue-600" strokeWidth={2} />
              </span>
              <p className="text-[11px] font-black text-slate-700 uppercase tracking-wide">Payment Methods</p>
            </div>

            {breakdown.length === 0 ? (
              <p className="text-[12px] text-slate-400 italic">No payment data</p>
            ) : (
              <div className="space-y-2.5">
                {breakdown.map(p => {
                  const cfg = getPaymentCfg(p.mode);
                  const pct = breakdownTotal > 0 ? Math.round((p.total / breakdownTotal) * 100) : 0;
                  return (
                    <div key={p.mode ?? "other"}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <cfg.icon className={cn("w-3 h-3", cfg.text)} strokeWidth={1.9} />
                          <span className="text-[12px] font-medium text-slate-700">{cfg.label}</span>
                          <span className="text-[10px] text-slate-400 tabnum">{p.count} bill{p.count !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] font-bold text-slate-700 tabnum">{fmtExact(p.total)}</span>
                          <span className="text-[10px] text-slate-400 tabnum w-7 text-right">{pct}%</span>
                        </div>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all duration-500", cfg.bar)}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Cash in drawer callout */}
            {cashAmount > 0 && (
              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <Banknote className="w-3.5 h-3.5 text-emerald-500" />
                  Cash in drawer
                </div>
                <span className="text-[13px] font-black text-emerald-700 tabnum">{fmtExact(cashAmount)}</span>
              </div>
            )}
          </div>

          {/* ── Column 3: Alerts ── */}
          <div className="p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <span className="w-5 h-5 rounded-md bg-amber-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-3 h-3 text-amber-600" strokeWidth={2} />
              </span>
              <p className="text-[11px] font-black text-slate-700 uppercase tracking-wide">Action Items</p>
            </div>

            <div className="space-y-2">
              {/* Low Stock */}
              <Link
                to="/dashboard/inventory"
                className={cn(
                  "flex items-center justify-between rounded-lg px-2.5 py-2 transition-colors group",
                  (stats?.lowStockCount ?? 0) > 0
                    ? "bg-red-50 hover:bg-red-100"
                    : "bg-slate-50 hover:bg-slate-100",
                )}
              >
                <div className="flex items-center gap-2">
                  <Package2 className={cn("w-3.5 h-3.5", (stats?.lowStockCount ?? 0) > 0 ? "text-red-500" : "text-slate-400")} strokeWidth={1.9} />
                  <span className={cn("text-[12px] font-medium", (stats?.lowStockCount ?? 0) > 0 ? "text-red-700" : "text-slate-500")}>
                    {(stats?.lowStockCount ?? 0) > 0 ? `${stats?.lowStockCount} Low Stock` : "Stock levels OK"}
                  </span>
                </div>
                <ArrowRight className="w-3 h-3 text-slate-300 group-hover:text-slate-500 transition-colors" />
              </Link>

              {/* Near Expiry — always visible so 0 is a positive signal */}
              <Link
                to="/dashboard/inventory"
                className={cn(
                  "flex items-center justify-between rounded-lg px-2.5 py-2 transition-colors group",
                  (stats?.nearExpiryCount ?? 0) > 0
                    ? "bg-orange-50 hover:bg-orange-100"
                    : "bg-slate-50 hover:bg-slate-100",
                )}
              >
                <div className="flex items-center gap-2">
                  <CalendarClock className={cn("w-3.5 h-3.5", (stats?.nearExpiryCount ?? 0) > 0 ? "text-orange-500" : "text-slate-400")} strokeWidth={1.9} />
                  <span className={cn("text-[12px] font-medium", (stats?.nearExpiryCount ?? 0) > 0 ? "text-orange-700" : "text-slate-500")}>
                    {(stats?.nearExpiryCount ?? 0) > 0 ? `${stats?.nearExpiryCount} Near Expiry` : "No batches expiring soon"}
                  </span>
                </div>
                <ArrowRight className="w-3 h-3 text-slate-300 group-hover:text-slate-500 transition-colors" />
              </Link>

              {/* Pending Credit */}
              {(stats?.pendingCredit ?? 0) > 0 && (
                <Link
                  to="/dashboard/billing"
                  className="flex items-center justify-between rounded-lg px-2.5 py-2 bg-blue-50 hover:bg-blue-100 transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-3.5 h-3.5 text-blue-500" strokeWidth={1.9} />
                    <span className="text-[12px] font-medium text-blue-700">
                      {fmt(stats?.pendingCredit ?? 0)} Credit Due
                    </span>
                  </div>
                  <ArrowRight className="w-3 h-3 text-slate-300 group-hover:text-slate-500 transition-colors" />
                </Link>
              )}

              {/* Overdue GRN Payments */}
              {(eodData?.overdueGrnCount ?? 0) > 0 && (
                <Link
                  to="/dashboard/purchase"
                  className="flex items-center justify-between rounded-lg px-2.5 py-2 bg-orange-50 hover:bg-orange-100 transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    <CircleAlert className="w-3.5 h-3.5 text-orange-500" strokeWidth={1.9} />
                    <span className="text-[12px] font-medium text-orange-700">
                      {eodData?.overdueGrnCount} Overdue Payments
                    </span>
                  </div>
                  <ArrowRight className="w-3 h-3 text-slate-300 group-hover:text-slate-500 transition-colors" />
                </Link>
              )}

              {/* All clear state — near-expiry is always shown above, so exclude from this check */}
              {(stats?.lowStockCount ?? 0) === 0 &&
               (stats?.pendingCredit ?? 0) === 0 &&
               (eodData?.overdueGrnCount ?? 0) === 0 && (
                <div className="flex items-center gap-2 rounded-lg px-2.5 py-2 bg-emerald-50">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" strokeWidth={1.9} />
                  <span className="text-[12px] font-medium text-emerald-700">All clear — no pending actions</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Top Medicines Card ───────────────────────────────────────────
function TopMedicinesCard({ eodData, loading }: { eodData: EodData | null; loading: boolean }) {
  const items = eodData?.topMedicines ?? [];

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mt-4">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50/80 to-white">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-orange-50 flex items-center justify-center">
            <Flame className="w-3.5 h-3.5 text-orange-500" strokeWidth={1.9} />
          </div>
          <h2 className="text-[13px] font-black text-slate-800">Top Medicines Today</h2>
        </div>
        <Link to="/dashboard/reports" className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 font-semibold">
          Analytics <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {loading ? (
        <div className="p-3 space-y-2.5">
          {[0,1,2].map(i => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-5 h-5 skeleton rounded" />
              <div className="flex-1 h-3 skeleton rounded" />
              <div className="w-10 h-3 skeleton rounded" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-slate-400">
          <Flame className="w-7 h-7 text-slate-200 mb-1.5" strokeWidth={1.4} />
          <p className="text-[12px] font-medium">No sales yet</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-2.5 px-4 py-2.5">
              <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-black flex items-center justify-center flex-shrink-0 tabnum">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-slate-800 truncate leading-tight">
                  {item.medicineName}
                </p>
                {item.genericName && (
                  <p className="text-[10px] text-slate-400 truncate">{item.genericName}</p>
                )}
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-[12px] font-bold text-slate-700 tabnum">{item.qtySold} qty</p>
                <p className="text-[10px] text-slate-400 tabnum">{fmt(item.revenue)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Near Expiry Card ─────────────────────────────────────────────
function daysUntil(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function NearExpiryCard({ items, loading, totalCount }: {
  items:      NearExpiryItem[];
  loading:    boolean;
  totalCount: number;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mt-4">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50/80 to-white">
        <div className="flex items-center gap-2">
          <div className={cn("w-6 h-6 rounded-md flex items-center justify-center",
            totalCount > 0 ? "bg-orange-50" : "bg-slate-50"
          )}>
            <CalendarClock className={cn("w-3.5 h-3.5", totalCount > 0 ? "text-orange-500" : "text-slate-400")} strokeWidth={1.9} />
          </div>
          <h2 className="text-[13px] font-black text-slate-800">Near Expiry</h2>
          {!loading && totalCount > 0 && (
            <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">
              {totalCount}
            </span>
          )}
        </div>
        <Link to="/dashboard/inventory" className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 font-semibold">
          Inventory <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-blue-300" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-slate-400">
          <CheckCircle2 className="w-8 h-8 text-emerald-200 mb-2" strokeWidth={1.4} />
          <p className="text-[13px] font-medium">No batches expiring soon</p>
          <p className="text-[11px] text-slate-400 mt-0.5">All stock is within safe expiry window</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {items.map(item => {
            const days   = daysUntil(item.expiryDate);
            const urgent = days <= 30;
            const warn   = days <= 60;
            return (
              <div key={item.id} className={cn(
                "flex items-start justify-between px-4 py-3",
                urgent ? "bg-red-50/40" : warn ? "bg-orange-50/30" : ""
              )}>
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-slate-800 truncate leading-tight">
                    {item.medicine.name}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {item.batchNumber && (
                      <span className="text-[10px] text-slate-400 font-mono">
                        {item.batchNumber}
                      </span>
                    )}
                    {item.medicine.genericName && (
                      <span className="text-[10px] text-slate-400 truncate">{item.medicine.genericName}</span>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0 ml-3 text-right">
                  <p className={cn(
                    "text-[12px] font-black tabnum leading-tight",
                    urgent ? "text-red-600" : warn ? "text-orange-600" : "text-amber-600"
                  )}>
                    {days}d
                  </p>
                  <p className="text-[10px] text-slate-400 tabnum">{item.quantity} qty</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50">
          <Link
            to="/dashboard/purchase"
            className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg border border-orange-200 text-[12px] font-bold text-orange-600 hover:bg-orange-50 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
            Return Expiring Stock to Supplier
          </Link>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────
export default function DashboardHomePage() {
  const isSupport = isSupportStaff();
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
  const [eodData,          setEodData]          = useState<EodData | null>(null);
  const [eodLoading,       setEodLoading]       = useState(true);
  const [nearExpiry,       setNearExpiry]       = useState<NearExpiryItem[]>([]);
  const [nearExpiryLoading,setNearExpiryLoading]= useState(true);
  const [refreshKey,       setRefreshKey]       = useState(0);
  const [auditOverview,    setAuditOverview]    = useState<AuditOverview | null>(null);

  useEffect(() => {
    if (isSupport) return;
    setStatsLoading(true);
    api.get("/billing/dashboard/stats")
      .then(({ data }) => setStats(data.data))
      .catch((err: unknown) => console.error("[Dashboard] stats fetch failed", err))
      .finally(() => setStatsLoading(false));
  }, [refreshKey, isSupport]);

  useEffect(() => {
    if (isSupport) return;
    setBillsLoading(true);
    const s = new Date(); s.setHours(0, 0, 0, 0);
    const e = new Date(); e.setHours(23, 59, 59, 999);
    api.get("/billing", { params: { page: 1, limit: 8, from: s.toISOString(), to: e.toISOString() } })
      .then(({ data }) => setRecentBills(data.data.items ?? []))
      .catch((err: unknown) => { console.error("[Dashboard] recent bills fetch failed", err); setRecentBills([]); })
      .finally(() => setBillsLoading(false));
  }, [refreshKey, isSupport]);

  useEffect(() => {
    if (isSupport) return;
    setStockLoading(true);
    api.get("/inventory", { params: { lowStock: true, limit: 6 } })
      .then(({ data }) => setLowStock(data.data.items ?? []))
      .catch((err: unknown) => { console.error("[Dashboard] low-stock fetch failed", err); setLowStock([]); })
      .finally(() => setStockLoading(false));
  }, [refreshKey, isSupport]);

  useEffect(() => {
    if (isSupport) return;
    setEodLoading(true);
    api.get("/reports/eod/summary")
      .then(({ data }) => setEodData(data.data))
      .catch((err: unknown) => { console.error("[Dashboard] EOD summary fetch failed", err); setEodData(null); })
      .finally(() => setEodLoading(false));
  }, [refreshKey, isSupport]);

  useEffect(() => {
    if (isSupport) return;
    setNearExpiryLoading(true);
    api.get("/inventory", { params: { nearExpiry: true, inStock: true, limit: 6 } })
      .then(({ data }) => setNearExpiry(data.data.items ?? []))
      .catch(() => setNearExpiry([]))
      .finally(() => setNearExpiryLoading(false));
  }, [refreshKey, isSupport]);

  // Audit overview — only for owner/manager (others have no actionable info)
  const _dashRole = getStoredUser()?.role ?? "";
  const _isOwnerOrMgr = _dashRole === "OWNER" || _dashRole === "MANAGER";
  useEffect(() => {
    if (isSupport || !_isOwnerOrMgr) return;
    api.get("/stock-audit/overview")
      .then(({ data }) => setAuditOverview(data.data))
      .catch(() => {}); // non-critical, silently ignore
  }, [refreshKey, isSupport, _isOwnerOrMgr]);

  // Guard: support staff have no pharmacy home — redirect after all hooks are initialised
  if (isSupport) return <Navigate to="/dashboard/support" replace />;

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
      label:       "Last 7 Days",
      value:       stats ? fmt(stats.last7DaysSales) : "—",
      sub:         stats ? `${stats.last7DaysCount} bills` : null,
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
      iconBg:      "bg-violet-50",
      iconColor:   "text-violet-600",
      accentColor: "bg-violet-500",
      href:        "/dashboard/billing?tab=returns",
    },
    {
      label:       "Low Stock",
      value:       stats ? String(stats.lowStockCount) : "—",
      sub:         stats?.lowStockCount ? `${stats.lowStockCount} below minimum` : "all levels OK",
      icon:        Package2,
      iconBg:      stats?.lowStockCount ? "bg-red-50"    : "bg-slate-50",
      iconColor:   stats?.lowStockCount ? "text-red-600" : "text-slate-400",
      accentColor: stats?.lowStockCount ? "bg-red-500"   : "bg-slate-200",
      href:        "/dashboard/inventory",
    },
    {
      label:       "Near Expiry",
      value:       stats ? String(stats.nearExpiryCount) : "—",
      sub:         stats?.nearExpiryCount ? "expiring in 90 days" : "all batches safe",
      icon:        CalendarClock,
      iconBg:      stats?.nearExpiryCount ? "bg-orange-50"    : "bg-slate-50",
      iconColor:   stats?.nearExpiryCount ? "text-orange-500" : "text-slate-400",
      accentColor: stats?.nearExpiryCount ? "bg-orange-500"   : "bg-slate-200",
      href:        "/dashboard/inventory",
    },
  ];

  const _userRole = getStoredUser()?.role ?? "";
  const _canViewReports = _userRole === "OWNER" || _userRole === "MANAGER";
  const QUICK_ACTIONS = [
    { href: "/dashboard/billing/new",  label: "New Bill",        icon: FilePlus,     kbd: "F2",  primary: true  },
    { href: "/dashboard/purchase",     label: "Purchase Order",  icon: ShoppingCart, kbd: null,  primary: false },
    { href: "/dashboard/inventory",    label: "Check Inventory", icon: Package2,     kbd: null,  primary: false },
    { href: "/dashboard/inventory?tab=audit", label: "Stock Audit", icon: ClipboardList, kbd: null, primary: false },
    { href: "/dashboard/billing",      label: "All Bills",       icon: FileText,     kbd: null,  primary: false },
    ...(_canViewReports ? [{ href: "/dashboard/reports", label: "Reports", icon: TrendingUp, kbd: null, primary: false }] : []),
  ];

  return (
    <div className="h-full overflow-y-auto bg-slate-50/50">
      <div className="max-w-[1440px] mx-auto px-5 py-5 space-y-5">

        {/* ── Hero Header ──────────────────────────────────── */}
        <motion.div {...fadeUp(0)}>
          <div
            className="relative overflow-hidden rounded-2xl px-5 py-4 flex items-center justify-between"
            style={{
              background: "linear-gradient(135deg, #0a1a52 0%, #101e60 45%, #162870 100%)",
              boxShadow: "0 4px 24px -4px rgba(10,26,82,0.35), 0 1px 0 0 rgba(255,255,255,0.04) inset",
            }}
          >
            {/* Decorative glow blobs */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
              <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full" style={{ background: "radial-gradient(ellipse, rgba(96,165,250,0.14) 0%, transparent 60%)" }} />
              <div className="absolute -bottom-8 right-28 w-36 h-36 rounded-full" style={{ background: "radial-gradient(ellipse, rgba(167,139,250,0.10) 0%, transparent 65%)" }} />
            </div>
            <div className="relative">
              <p className="text-white/50 text-[11px] font-semibold tracking-wide">{getTimeGreeting()}</p>
              <h1 className="text-[20px] font-black text-white leading-tight mt-0.5">Dashboard</h1>
              <p className="text-white/35 text-[11px] mt-0.5">{today}</p>
            </div>
            <div className="relative flex items-center gap-2">
              <button
                onClick={() => setRefreshKey(k => k + 1)}
                className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/18 flex items-center justify-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                aria-label="Refresh dashboard"
              >
                <RefreshCw className="w-3.5 h-3.5 text-white/60" strokeWidth={1.8} />
              </button>
              <button
                onClick={() => navigate("/dashboard/billing/new")}
                className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-blue-50 rounded-xl text-[13px] font-black transition-all shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                style={{ color: "#0a1a52" }}
                aria-label="New Bill (F2)"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
                New Bill
                <kbd className="text-[9px] rounded px-1 py-0.5 font-mono leading-none ml-0.5" style={{ background: "rgba(10,26,82,0.08)", color: "rgba(10,26,82,0.5)" }}>F2</kbd>
              </button>
            </div>
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
                  "flex items-center gap-2 px-3 py-1.5 rounded-xl text-[12px] font-bold transition-all duration-150",
                  "hover:-translate-y-px active:translate-y-0",
                  primary
                    ? "bg-blue-600 hover:bg-blue-500 text-white shadow-sm hover:shadow-md"
                    : "bg-white text-slate-700 border border-slate-200 hover:border-blue-200/80 hover:bg-blue-50/40 shadow-sm hover:shadow"
                )}
              >
                <span className={cn(
                  "w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0",
                  primary ? "bg-white/20" : "bg-slate-100"
                )}>
                  <Icon className={cn("w-3 h-3", primary ? "text-white" : "text-slate-600")} strokeWidth={2} />
                </span>
                {label}
                {kbd && (
                  <kbd className={cn("text-[9px] rounded px-1 py-0.5 font-mono leading-none ml-0.5",
                    primary ? "bg-white/20 text-white/70" : "bg-slate-100 text-slate-400"
                  )}>{kbd}</kbd>
                )}
              </Link>
            ))}
          </div>
        </motion.div>

        {/* ── Stat cards — 4-col tablet / 7-col desktop ───── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
          {STAT_CARDS.map((s, i) => (
            <motion.div key={s.label} {...fadeUp(0.06 + i * 0.03)}>
              <StatCard {...s} loading={statsLoading} />
            </motion.div>
          ))}
        </div>

        {/* ── EOD Summary ──────────────────────────────────── */}
        <motion.div {...fadeUp(0.20)}>
          <EodSummaryCard
            stats={stats}
            eodData={eodData}
            loading={statsLoading || eodLoading}
          />
        </motion.div>

        {/* ── Audit status banner (owner/manager only, shown when actionable) ─── */}
        {_isOwnerOrMgr && auditOverview && (auditOverview.active || auditOverview.needsApproval || (auditOverview.daysSinceLastAudit !== null && auditOverview.daysSinceLastAudit > 30) || auditOverview.lastApproved === null) && (
          <motion.div {...fadeUp(0.23)}>
            {auditOverview.needsApproval ? (
              <Link to={`/dashboard/stock-audit/${auditOverview.needsApproval.id}`}
                className="flex items-center gap-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors">
                <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center flex-shrink-0">
                  <ClipboardList className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-amber-900">Audit awaiting approval</p>
                  <p className="text-[11px] text-amber-700">{auditOverview.needsApproval.sessionNumber} — review variances and approve to update stock</p>
                </div>
                <ArrowRight className="w-4 h-4 text-amber-600 flex-shrink-0" />
              </Link>
            ) : auditOverview.active ? (
              <Link to={`/dashboard/stock-audit/${auditOverview.active.id}`}
                className="flex items-center gap-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
                  <ClipboardList className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-blue-900">
                    Stock audit {auditOverview.active.status === "IN_PROGRESS" ? "in progress" : "draft"}
                    <span className="ml-2 text-[10px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full animate-pulse">LIVE</span>
                  </p>
                  <p className="text-[11px] text-blue-700">
                    {auditOverview.active.sessionNumber} · {auditOverview.active.countedItems} of {auditOverview.active.totalItems} items counted
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-blue-600 flex-shrink-0" />
              </Link>
            ) : (
              <Link to="/dashboard/inventory?tab=audit"
                className="flex items-center gap-4 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors">
                <div className="w-8 h-8 rounded-lg bg-slate-300 flex items-center justify-center flex-shrink-0">
                  <ClipboardList className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-slate-700">
                    {auditOverview.lastApproved === null ? "No stock audit done yet" : `Last audit ${auditOverview.daysSinceLastAudit} days ago`}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {auditOverview.lastApproved === null
                      ? "Running a stock audit helps detect missing stock and billing errors"
                      : "Consider running a new audit to keep your stock accurate"}
                  </p>
                </div>
                <span className="text-[12px] font-semibold text-blue-600 whitespace-nowrap">Start audit →</span>
              </Link>
            )}
          </motion.div>
        )}

        {/* ── Two-column section ───────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

          {/* Today's Bills */}
          <motion.div {...fadeUp(0.26)} className="xl:col-span-2">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">

              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50/80 to-white">
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

          {/* Right column: Low Stock + Top Medicines */}
          <motion.div {...fadeUp(0.30)}>

            {/* Low Stock */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50/80 to-white">
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
                <div className="flex flex-col items-center justify-center py-8 text-slate-400">
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

            {/* Near Expiry */}
            <NearExpiryCard
              items={nearExpiry}
              loading={nearExpiryLoading}
              totalCount={stats?.nearExpiryCount ?? 0}
            />

            {/* Top Medicines Today */}
            <TopMedicinesCard eodData={eodData} loading={eodLoading} />

          </motion.div>

        </div>
      </div>
    </div>
  );
}
