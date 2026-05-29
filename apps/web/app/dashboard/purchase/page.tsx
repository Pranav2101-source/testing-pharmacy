"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShoppingCart,
  Plus,
  Search,
  Filter,
  Eye,
  Truck,
  CheckCircle2,
  Clock,
  XCircle,
  ChevronDown,
  Package2,
  Calendar,
  IndianRupee,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────
type POStatus = "pending" | "ordered" | "received" | "cancelled";

interface PurchaseOrder {
  id:         string;
  supplier:   string;
  items:      number;
  amount:     number;
  status:     POStatus;
  createdAt:  string;
  expectedAt: string;
}

// ─── Mock data (TODO: replace with GET /api/purchase-orders) ──
const INIT_POS: PurchaseOrder[] = [
  { id: "PO-0042", supplier: "Medline Distributors",  items: 14, amount: 24800,  status: "received",  createdAt: "25 May 2026", expectedAt: "27 May 2026" },
  { id: "PO-0041", supplier: "Apollo Pharmacy Hub",   items: 8,  amount: 12400,  status: "ordered",   createdAt: "24 May 2026", expectedAt: "29 May 2026" },
  { id: "PO-0040", supplier: "Sun Pharma Wholesale",  items: 22, amount: 38500,  status: "pending",   createdAt: "23 May 2026", expectedAt: "30 May 2026" },
  { id: "PO-0039", supplier: "MedEquip Supplies",     items: 6,  amount: 9200,   status: "cancelled", createdAt: "20 May 2026", expectedAt: "—"           },
  { id: "PO-0038", supplier: "Cipla Distributors",    items: 18, amount: 31000,  status: "received",  createdAt: "18 May 2026", expectedAt: "21 May 2026" },
];

// ─── Status config ────────────────────────────────────────────
const STATUS_CONFIG: Record<POStatus, { label: string; color: string; icon: React.ElementType }> = {
  pending:   { label: "Pending",   color: "bg-amber-100  text-amber-700",   icon: Clock        },
  ordered:   { label: "Ordered",   color: "bg-blue-100   text-blue-700",    icon: Truck        },
  received:  { label: "Received",  color: "bg-emerald-100 text-emerald-700",icon: CheckCircle2 },
  cancelled: { label: "Cancelled", color: "bg-red-100    text-red-600",     icon: XCircle      },
};

const FILTER_OPTIONS: { label: string; value: POStatus | "all" }[] = [
  { label: "All",       value: "all"       },
  { label: "Pending",   value: "pending"   },
  { label: "Ordered",   value: "ordered"   },
  { label: "Received",  value: "received"  },
  { label: "Cancelled", value: "cancelled" },
];

// ─── Stats ────────────────────────────────────────────────────
function getStats(orders: PurchaseOrder[]) {
  return {
    total:    orders.length,
    pending:  orders.filter(o => o.status === "pending").length,
    ordered:  orders.filter(o => o.status === "ordered").length,
    received: orders.filter(o => o.status === "received").length,
    spend:    orders.filter(o => o.status !== "cancelled").reduce((a, o) => a + o.amount, 0),
  };
}

// ─── Page ─────────────────────────────────────────────────────
export default function PurchasePage() {
  const [orders,  setOrders]  = useState<PurchaseOrder[]>(INIT_POS);
  const [search,  setSearch]  = useState("");
  const [filter,  setFilter]  = useState<POStatus | "all">("all");
  const [showNew, setShowNew] = useState(false);

  const stats = getStats(orders);

  const filtered = orders.filter(o => {
    const matchSearch = o.id.toLowerCase().includes(search.toLowerCase()) ||
                        o.supplier.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || o.status === filter;
    return matchSearch && matchFilter;
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black text-slate-800">Purchase Orders</h1>
            <p className="text-sm text-slate-400 mt-0.5">{stats.total} orders total</p>
          </div>
          <motion.button
            whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" strokeWidth={2} />
            New Order
          </motion.button>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Pending",  value: stats.pending,  icon: Clock,        iconBg: "bg-amber-50",   iconColor: "text-amber-600"   },
            { label: "Ordered",  value: stats.ordered,  icon: Truck,        iconBg: "bg-blue-50",    iconColor: "text-blue-600"    },
            { label: "Received", value: stats.received, icon: CheckCircle2, iconBg: "bg-emerald-50", iconColor: "text-emerald-600" },
            { label: "Total Spend", value: `₹${(stats.spend / 1000).toFixed(1)}k`, icon: IndianRupee, iconBg: "bg-brand-50", iconColor: "text-brand-600" },
          ].map(({ label, value, icon: Icon, iconBg, iconColor }) => (
            <div key={label} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
              <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0", iconBg)}>
                <Icon className={cn("w-4 h-4", iconColor)} strokeWidth={1.8} />
              </div>
              <div>
                <p className="text-xl font-black text-slate-800">{value}</p>
                <p className="text-[11px] text-slate-500 font-semibold">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-white">
            <Search className="w-4 h-4 text-slate-400 flex-shrink-0" strokeWidth={1.8} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by PO number or supplier…"
              className="flex-1 text-sm text-slate-700 placeholder-slate-300 bg-transparent outline-none"
            />
          </div>
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1">
            {FILTER_OPTIONS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                  filter === value
                    ? "bg-brand-600 text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_1.6fr_80px_100px_110px_90px] gap-4 px-5 py-3 border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wide">
            <span>PO Number</span>
            <span>Supplier</span>
            <span>Items</span>
            <span>Amount</span>
            <span>Status</span>
            <span>Expected</span>
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <ShoppingCart className="w-10 h-10 mb-3 opacity-30" strokeWidth={1.4} />
              <p className="text-sm font-semibold">No orders found</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {filtered.map((po, i) => {
                const { label, color, icon: StatusIcon } = STATUS_CONFIG[po.status];
                return (
                  <motion.div
                    key={po.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="grid grid-cols-[1fr_1.6fr_80px_100px_110px_90px] gap-4 items-center px-5 py-3.5 hover:bg-slate-50/60 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                        <Package2 className="w-3.5 h-3.5 text-brand-600" strokeWidth={1.8} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-800">{po.id}</p>
                        <p className="text-[10px] text-slate-400">{po.createdAt}</p>
                      </div>
                    </div>
                    <p className="text-sm font-medium text-slate-700 truncate">{po.supplier}</p>
                    <p className="text-sm font-semibold text-slate-700">{po.items}</p>
                    <p className="text-sm font-bold text-slate-800">₹{po.amount.toLocaleString("en-IN")}</p>
                    <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full w-fit", color)}>
                      <StatusIcon className="w-3 h-3" strokeWidth={2} />
                      {label}
                    </span>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      <Calendar className="w-3 h-3" strokeWidth={1.8} />
                      {po.expectedAt}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Coming soon banner for new order modal */}
        <AnimatePresence>
          {showNew && (
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowNew(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                onClick={e => e.stopPropagation()}
                className="bg-white rounded-2xl border border-slate-200 shadow-2xl p-8 max-w-sm w-full text-center"
              >
                <div className="w-14 h-14 rounded-2xl bg-brand-50 flex items-center justify-center mx-auto mb-4">
                  <ShoppingCart className="w-7 h-7 text-brand-600" strokeWidth={1.5} />
                </div>
                <h2 className="text-lg font-black text-slate-800 mb-2">Coming Soon</h2>
                <p className="text-sm text-slate-500 leading-relaxed mb-6">
                  The full purchase order creation flow is being built. You&apos;ll be able to add suppliers, select items, and track deliveries.
                </p>
                <button
                  onClick={() => setShowNew(false)}
                  className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold transition-colors"
                >
                  Got it
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
