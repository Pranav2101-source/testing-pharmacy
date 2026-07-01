"use client";

import { useMemo } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { Receipt, Package, Hash, Tag, Percent, TrendingUp, Sparkles } from "lucide-react";
import { useBillingStore } from "./useBillingStore";
import { cn } from "@/lib/utils";

type SummaryRow = {
  label: string;
  value: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  highlight?: boolean;
  muted?: boolean;
};

// Spring animation config
const spring = { type: "spring" as const, stiffness: 380, damping: 30 };

// Staggered container
const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.055 } },
};
const rowVariants: Variants = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.22, ease: "easeOut" } },
};

export function BillSummaryCard() {
  const items = useBillingStore((s) => s.items);
  const getTotals = useBillingStore((s) => s.getTotals);

  const totals = useMemo(() => getTotals(), [getTotals]);
  const totalQty = useMemo(() => items.reduce((s, i) => s + i.quantity, 0), [items]);
  const rounded = Math.round(totals.totalAmount);

  const rows: SummaryRow[] = [
    {
      label: "Items",
      value: String(items.length),
      icon: Package,
      iconColor: "text-indigo-500",
      iconBg: "bg-indigo-50",
    },
    {
      label: "Qty",
      value: String(totalQty),
      icon: Hash,
      iconColor: "text-violet-500",
      iconBg: "bg-violet-50",
    },
    {
      label: "Sub Total",
      value: `₹${totals.subtotal.toFixed(2)}`,
      icon: Receipt,
      iconColor: "text-slate-500",
      iconBg: "bg-slate-50",
    },
    {
      label: "Discount",
      value: totals.discountAmount > 0 ? `-₹${totals.discountAmount.toFixed(2)}` : "₹0.00",
      icon: Tag,
      iconColor: totals.discountAmount > 0 ? "text-rose-500" : "text-slate-400",
      iconBg: totals.discountAmount > 0 ? "bg-rose-50" : "bg-slate-50",
      muted: totals.discountAmount === 0,
    },
    {
      label: "CGST",
      value: `₹${totals.cgst.toFixed(2)}`,
      icon: Percent,
      iconColor: "text-amber-500",
      iconBg: "bg-amber-50",
      muted: totals.cgst === 0,
    },
    {
      label: "SGST",
      value: `₹${totals.sgst.toFixed(2)}`,
      icon: Percent,
      iconColor: "text-orange-500",
      iconBg: "bg-orange-50",
      muted: totals.sgst === 0,
    },
    {
      label: "Total GST",
      value: `₹${totals.totalGst.toFixed(2)}`,
      icon: TrendingUp,
      iconColor: "text-emerald-500",
      iconBg: "bg-emerald-50",
    },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-card overflow-hidden card-glow-hover">

      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-50 flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-blue-50 flex items-center justify-center">
          <Sparkles className="w-3.5 h-3.5 text-blue-500" strokeWidth={2} />
        </div>
        <h3 className="text-sm font-semibold text-slate-800">Bill Summary</h3>
      </div>

      {/* Rows */}
      <AnimatePresence mode="wait">
        <motion.div
          key={items.length}
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="px-3 py-2.5 space-y-1"
        >
          {rows.map(({ label, value, icon: Icon, iconColor, iconBg, muted }) => (
            <motion.div
              key={label}
              variants={rowVariants}
              className="flex items-center justify-between gap-2 px-1 py-1.5 rounded-xl hover:bg-slate-50 transition-colors duration-100 group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={cn("w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0", iconBg)}>
                  <Icon className={cn("w-2.5 h-2.5", iconColor)} strokeWidth={2.2} />
                </div>
                <span className={cn("text-xs font-medium", muted ? "text-slate-400" : "text-slate-500")}>
                  {label}
                </span>
              </div>
              <span className={cn(
                "text-xs font-semibold tabnum tabular-nums",
                muted ? "text-slate-300" : "text-slate-700"
              )}>
                {value}
              </span>
            </motion.div>
          ))}
        </motion.div>
      </AnimatePresence>

      {/* Net Payable — prominent gradient section */}
      <div className={cn(
        "mx-3 mb-3 rounded-xl overflow-hidden",
        "bg-gradient-to-br from-blue-600 via-blue-600 to-indigo-700",
        "shadow-[0_4px_20px_-4px_rgba(37,99,235,0.5)]",
        "transition-shadow duration-300",
        items.length > 0 && "shadow-[0_6px_28px_-4px_rgba(37,99,235,0.6)]"
      )}>
        <div className="px-4 py-3.5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-blue-200 uppercase tracking-widest">Net Payable</p>
              <p className="text-[10px] text-blue-300/70 mt-0.5">Incl. all taxes</p>
            </div>
            <AnimatePresence mode="popLayout">
              <motion.div
                key={rounded}
                initial={{ scale: 0.8, opacity: 0, y: 6 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: -4 }}
                transition={spring}
                className="text-right"
              >
                <span className="text-2xl font-black text-white tracking-tight tabnum tabular-nums drop-shadow-sm">
                  ₹{rounded.toFixed(2)}
                </span>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Rounded indicator bar */}
          {totals.discountAmount > 0 && (
            <motion.div
              initial={{ opacity: 0, scaleX: 0 }}
              animate={{ opacity: 1, scaleX: 1 }}
              className="mt-2.5 pt-2.5 border-t border-white/15 flex items-center justify-between"
            >
              <span className="text-[10px] text-blue-200 font-medium">You saved</span>
              <span className="text-[11px] font-bold text-emerald-300">
                ₹{totals.discountAmount.toFixed(2)}
              </span>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
