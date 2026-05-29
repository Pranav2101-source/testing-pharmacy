"use client";

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
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────
type TrendDir = "up" | "down";

interface StatCard {
  label:     string;
  value:     string;
  sub:       string;
  trend:     number;
  trendDir:  TrendDir;
  icon:      React.ElementType;
  iconBg:    string;
  iconColor: string;
}

interface RecentBill {
  id:       string;
  patient:  string;
  amount:   number;
  items:    number;
  time:     string;
  status:   "paid" | "pending" | "cancelled";
}

interface LowStockItem {
  name:      string;
  brand:     string;
  stock:     number;
  threshold: number;
  unit:      string;
}

// ─── Mock data (replace with API calls) ───────────────────────
const STATS: StatCard[] = [
  {
    label:     "Today's Sales",
    value:     "₹18,430",
    sub:       "32 bills generated",
    trend:     12.4,
    trendDir:  "up",
    icon:      IndianRupee,
    iconBg:    "bg-emerald-50",
    iconColor: "text-emerald-600",
  },
  {
    label:     "Pending Bills",
    value:     "4",
    sub:       "₹3,240 outstanding",
    trend:     2,
    trendDir:  "down",
    icon:      FileText,
    iconBg:    "bg-amber-50",
    iconColor: "text-amber-600",
  },
  {
    label:     "Items Sold",
    value:     "184",
    sub:       "Across 32 bills",
    trend:     8.1,
    trendDir:  "up",
    icon:      Package2,
    iconBg:    "bg-blue-50",
    iconColor: "text-blue-600",
  },
  {
    label:     "Active Staff",
    value:     "3",
    sub:       "1 owner · 2 pharmacists",
    trend:     0,
    trendDir:  "up",
    icon:      Users,
    iconBg:    "bg-purple-50",
    iconColor: "text-purple-600",
  },
];

const RECENT_BILLS: RecentBill[] = [
  { id: "B-1048", patient: "Ramesh Kumar",   amount: 842,  items: 5, time: "2 min ago",  status: "paid"      },
  { id: "B-1047", patient: "Priya Sharma",   amount: 1230, items: 8, time: "14 min ago", status: "paid"      },
  { id: "B-1046", patient: "Amit Verma",     amount: 560,  items: 3, time: "31 min ago", status: "pending"   },
  { id: "B-1045", patient: "Sunita Devi",    amount: 2100, items: 12,time: "1 hr ago",   status: "paid"      },
  { id: "B-1044", patient: "Karan Mehta",    amount: 390,  items: 2, time: "2 hr ago",   status: "cancelled" },
];

const LOW_STOCK: LowStockItem[] = [
  { name: "Paracetamol 500mg",  brand: "Calpol",   stock: 12,  threshold: 50,  unit: "strips"  },
  { name: "Metformin 500mg",    brand: "Glycomet", stock: 8,   threshold: 30,  unit: "strips"  },
  { name: "Azithromycin 500mg", brand: "Azee",     stock: 4,   threshold: 20,  unit: "tabs"    },
  { name: "Omeprazole 20mg",    brand: "Omez",     stock: 18,  threshold: 40,  unit: "caps"    },
];

const QUICK_LINKS = [
  { href: "/dashboard/billing",   label: "New Bill",        icon: FileText,     color: "bg-brand-600 hover:bg-brand-700 text-white" },
  { href: "/dashboard/purchase",  label: "Purchase Order",  icon: ShoppingCart, color: "bg-white hover:bg-slate-50 text-slate-700 border border-slate-200" },
  { href: "/dashboard/inventory", label: "Check Inventory", icon: Package2,     color: "bg-white hover:bg-slate-50 text-slate-700 border border-slate-200" },
];

// ─── Sub-components ───────────────────────────────────────────
const statusConfig = {
  paid:      { label: "Paid",      color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  pending:   { label: "Pending",   color: "bg-amber-100 text-amber-700",     icon: Clock        },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-600",         icon: XCircle      },
};

function TrendBadge({ dir, value }: { dir: TrendDir; value: number }) {
  if (value === 0) return null;
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 text-[11px] font-semibold",
      dir === "up" ? "text-emerald-600" : "text-red-500"
    )}>
      {dir === "up"
        ? <TrendingUp   className="w-3 h-3" strokeWidth={2} />
        : <TrendingDown className="w-3 h-3" strokeWidth={2} />
      }
      {value}%
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────
const fadeUp = (delay: number) => ({
  initial:    { opacity: 0, y: 12 },
  animate:    { opacity: 1, y: 0  },
  transition: { duration: 0.3, delay },
});

export default function DashboardHomePage() {
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">

        {/* ── Header ─────────────────────────────────────────── */}
        <motion.div {...fadeUp(0)} className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-black text-slate-800">Dashboard</h1>
            <p className="text-sm text-slate-400 mt-0.5">{today}</p>
          </div>
          <button className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-brand-600 font-semibold transition-colors">
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
          {STATS.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div key={s.label} {...fadeUp(0.08 + i * 0.04)}>
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", s.iconBg)}>
                      <Icon className={cn("w-4.5 h-4.5", s.iconColor)} strokeWidth={1.8} />
                    </div>
                    <TrendBadge dir={s.trendDir} value={s.trend} />
                  </div>
                  <div>
                    <p className="text-2xl font-black text-slate-800">{s.value}</p>
                    <p className="text-xs font-semibold text-slate-500 mt-0.5">{s.label}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{s.sub}</p>
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
                <h2 className="text-sm font-black text-slate-800">Recent Bills</h2>
                <Link
                  href="/dashboard/billing"
                  className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-semibold transition-colors"
                >
                  View all <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="divide-y divide-slate-50">
                {RECENT_BILLS.map((bill) => {
                  const { label, color, icon: StatusIcon } = statusConfig[bill.status];
                  return (
                    <div key={bill.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50/60 transition-colors">
                      <div className="w-8 h-8 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-3.5 h-3.5 text-brand-600" strokeWidth={1.8} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 truncate">{bill.patient}</p>
                        <p className="text-[11px] text-slate-400">{bill.id} · {bill.items} items · {bill.time}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-slate-800">₹{bill.amount.toLocaleString("en-IN")}</p>
                        <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full mt-0.5", color)}>
                          <StatusIcon className="w-2.5 h-2.5" strokeWidth={2} />
                          {label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>

          {/* Low Stock Alerts */}
          <motion.div {...fadeUp(0.26)}>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-full">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-black text-slate-800">Low Stock</h2>
                  <span className="w-5 h-5 rounded-full bg-red-100 text-red-600 text-[10px] font-black flex items-center justify-center">
                    {LOW_STOCK.length}
                  </span>
                </div>
                <Link
                  href="/dashboard/inventory"
                  className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-semibold transition-colors"
                >
                  Inventory <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="divide-y divide-slate-50">
                {LOW_STOCK.map((item) => {
                  const pct = Math.round((item.stock / item.threshold) * 100);
                  return (
                    <div key={item.name} className="px-5 py-3.5">
                      <div className="flex items-start justify-between mb-1.5">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-800 truncate">{item.name}</p>
                          <p className="text-[10px] text-slate-400">{item.brand}</p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                          <AlertTriangle className="w-3 h-3 text-amber-500" strokeWidth={2} />
                          <span className="text-xs font-bold text-amber-600">{item.stock} {item.unit}</span>
                        </div>
                      </div>
                      {/* Stock bar */}
                      <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            pct < 25 ? "bg-red-400" : pct < 50 ? "bg-amber-400" : "bg-emerald-400"
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">Min. required: {item.threshold} {item.unit}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>

        </div>
      </div>
    </div>
  );
}
