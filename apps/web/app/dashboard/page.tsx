"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  FileText,
  Package2,
  ShoppingCart,
  AlertTriangle,
  IndianRupee,
  Users,
  Clock,
  ArrowRight,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Loader2,
  RotateCcw,
  CreditCard,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────
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
  items:         { quantity: number }[];
};

type LowStockItem = {
  id:           string;
  quantity:     number;
  minimumStock: number;
  medicine:     { name: string; genericName: string | null };
};

// ─── Helpers ──────────────────────────────────────────────────
function fmtCurrency(n: number) {
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

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  PAID:      { label: "Paid",      color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  PENDING:   { label: "Pending",   color: "bg-amber-100 text-amber-700",     icon: Clock        },
  PARTIAL:   { label: "Partial",   color: "bg-orange-100 text-orange-700",   icon: Clock        },
  CANCELLED: { label: "Cancelled", color: "bg-red-100 text-red-600",         icon: XCircle      },
};

// ─── Page ─────────────────────────────────────────────────────
const fadeUp = (delay: number) => ({
  initial:    { opacity: 0, y: 12 },
  animate:    { opacity: 1, y: 0  },
  transition: { duration: 0.3, delay },
});

const QUICK_LINKS = [
  { href: "/dashboard/billing/new", label: "New Bill",        icon: FileText,     color: "bg-blue-600 hover:bg-blue-700 text-white" },
  { href: "/dashboard/purchase",    label: "Purchase Order",  icon: ShoppingCart, color: "bg-white hover:bg-slate-50 text-slate-700 border border-slate-200" },
  { href: "/dashboard/inventory",   label: "Check Inventory", icon: Package2,     color: "bg-white hover:bg-slate-50 text-slate-700 border border-slate-200" },
];

export default function DashboardHomePage() {
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const [stats,         setStats]         = useState<DashboardStats | null>(null);
  const [statsLoading,  setStatsLoading]  = useState(true);
  const [recentBills,   setRecentBills]   = useState<RecentInvoice[]>([]);
  const [billsLoading,  setBillsLoading]  = useState(true);
  const [lowStock,      setLowStock]      = useState<LowStockItem[]>([]);
  const [stockLoading,  setStockLoading]  = useState(true);
  const [refreshKey,    setRefreshKey]    = useState(0);

  useEffect(() => {
    setStatsLoading(true);
    api.get("/billing/dashboard/stats")
      .then(({ data }) => setStats(data.data))
      .catch(() => {/* non-critical */})
      .finally(() => setStatsLoading(false));
  }, [refreshKey]);

  useEffect(() => {
    setBillsLoading(true);
    const today = new Date().toISOString().split("T")[0];
    api.get("/billing", { params: { page: 1, limit: 8, from: today, to: today } })
      .then(({ data }) => setRecentBills(data.data.items ?? []))
      .catch(() => setRecentBills([]))
      .finally(() => setBillsLoading(false));
  }, [refreshKey]);

  useEffect(() => {
    setStockLoading(true);
    api.get("/inventory", { params: { lowStock: true, limit: 5 } })
      .then(({ data }) => setLowStock(data.data.items ?? []))
      .catch(() => setLowStock([]))
      .finally(() => setStockLoading(false));
  }, [refreshKey]);

  const STAT_CARDS = [
    {
      label:    "Today's Sales",
      value:    stats ? fmtCurrency(stats.todaySales) : "—",
      sub:      stats ? `${stats.todayCount} bill${stats.todayCount !== 1 ? "s" : ""}` : null,
      trend:    null,
      icon:     IndianRupee,
      iconBg:   "bg-emerald-50",
      iconColor:"text-emerald-600",
    },
    {
      label:    "Pending / Credit",
      value:    stats ? fmtCurrency(stats.pendingCredit) : "—",
      sub:      null,
      trend:    null,
      icon:     CreditCard,
      iconBg:   "bg-amber-50",
      iconColor:"text-amber-600",
    },
    {
      label:    "Today's Returns",
      value:    stats ? fmtCurrency(stats.todayReturns) : "—",
      sub:      null,
      trend:    null,
      icon:     RotateCcw,
      iconBg:   "bg-rose-50",
      iconColor:"text-rose-600",
    },
    {
      label:    "Low Stock Items",
      value:    stats ? String(stats.lowStockCount) : "—",
      sub:      stats && stats.nearExpiryCount > 0 ? `${stats.nearExpiryCount} near expiry` : null,
      trend:    null,
      icon:     Package2,
      iconBg:   "bg-blue-50",
      iconColor:"text-blue-600",
    },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">

        {/* ── Header ─────────────────────────────────────────── */}
        <motion.div {...fadeUp(0)} className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-black text-slate-800">Dashboard</h1>
            <p className="text-sm text-slate-400 mt-0.5">{today}</p>
          </div>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 font-semibold transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </motion.div>

        {/* ── Quick actions ──────────────────────────────────── */}
        <motion.div {...fadeUp(0.05)} className="flex flex-wrap gap-2.5">
          {QUICK_LINKS.map(({ href, label, icon: Icon, color }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-all",
                color
              )}
            >
              <Icon className="w-4 h-4" strokeWidth={1.8} />
              {label}
            </Link>
          ))}
        </motion.div>

        {/* ── Stat cards ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {STAT_CARDS.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div key={s.label} {...fadeUp(0.08 + i * 0.04)}>
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", s.iconBg)}>
                      <Icon className={cn("w-4.5 h-4.5", s.iconColor)} strokeWidth={1.8} />
                    </div>
                  </div>
                  <div>
                    {statsLoading ? (
                      <div className="h-7 w-24 bg-slate-100 animate-pulse rounded mb-1" />
                    ) : (
                      <p className="text-2xl font-black text-slate-800">{s.value}</p>
                    )}
                    <p className="text-xs font-semibold text-slate-500 mt-0.5">{s.label}</p>
                    {s.sub && !statsLoading && (
                      <p className="text-[11px] text-slate-400 mt-0.5">{s.sub}</p>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* ── Two-column section ─────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* Recent Bills */}
          <motion.div {...fadeUp(0.22)} className="xl:col-span-2">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <h2 className="text-sm font-black text-slate-800">Today&apos;s Bills</h2>
                <Link
                  href="/dashboard/billing"
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-semibold transition-colors"
                >
                  View all <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              {billsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                </div>
              ) : recentBills.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <FileText className="w-8 h-8 text-slate-200 mb-2" strokeWidth={1.4} />
                  <p className="text-[13px]">No bills today yet</p>
                  <Link href="/dashboard/billing/new" className="text-blue-600 text-[12px] mt-1 hover:underline">
                    Create the first one
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {recentBills.map((bill) => {
                    const statusKey = bill.isCancelled ? "CANCELLED" : bill.paymentStatus;
                    const { label, color, icon: StatusIcon } = statusConfig[statusKey] ?? statusConfig.PAID;
                    const totalQty = bill.items.reduce((s, i) => s + i.quantity, 0);
                    return (
                      <Link
                        key={bill.id}
                        href={`/dashboard/billing/${bill.id}`}
                        className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50/60 transition-colors"
                      >
                        <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                          <FileText className="w-3.5 h-3.5 text-blue-600" strokeWidth={1.8} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-800 truncate">
                            {bill.customer?.name ?? "Walk-in"}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {bill.invoiceNumber} · {totalQty} items · {timeAgo(bill.createdAt)}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-bold text-slate-800">
                            ₹{bill.totalAmount.toLocaleString("en-IN")}
                          </p>
                          <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full mt-0.5", color)}>
                            <StatusIcon className="w-2.5 h-2.5" strokeWidth={2} />
                            {label}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>

          {/* Low Stock Alerts */}
          <motion.div {...fadeUp(0.26)}>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-full">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-black text-slate-800">Low Stock</h2>
                  {!stockLoading && lowStock.length > 0 && (
                    <span className="w-5 h-5 rounded-full bg-red-100 text-red-600 text-[10px] font-black flex items-center justify-center">
                      {lowStock.length}
                    </span>
                  )}
                </div>
                <Link
                  href="/dashboard/inventory?tab=lowStock"
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-semibold transition-colors"
                >
                  Inventory <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              {stockLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                </div>
              ) : lowStock.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <CheckCircle2 className="w-8 h-8 text-emerald-200 mb-2" strokeWidth={1.4} />
                  <p className="text-[13px]">All stock levels OK</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {lowStock.map((item) => {
                    const pct = item.minimumStock > 0
                      ? Math.min(100, Math.round((item.quantity / item.minimumStock) * 100))
                      : 100;
                    return (
                      <div key={item.id} className="px-5 py-3.5">
                        <div className="flex items-start justify-between mb-1.5">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-800 truncate">{item.medicine.name}</p>
                            {item.medicine.genericName && (
                              <p className="text-[10px] text-slate-400">{item.medicine.genericName}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                            <AlertTriangle className="w-3 h-3 text-amber-500" strokeWidth={2} />
                            <span className="text-xs font-bold text-amber-600">{item.quantity} left</span>
                          </div>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              pct < 25 ? "bg-red-400" : pct < 50 ? "bg-amber-400" : "bg-emerald-400"
                            )}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">Min. required: {item.minimumStock}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>

        </div>
      </div>
    </div>
  );
}
