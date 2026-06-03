"use client";

import { format } from "date-fns";
import { Calendar, User, Stethoscope, Search, ChevronDown, MoreHorizontal } from "lucide-react";
import { motion } from "framer-motion";
import { useBillingStore } from "./useBillingStore";
import { cn } from "@/lib/utils";

const BILLING_FOR_OPTIONS = ["Self", "Counter", "Credit", "Insurance"] as const;

function Divider() {
  return <div className="w-px self-stretch bg-slate-100 flex-shrink-0 my-2" />;
}

export function BillHeader() {
  const { meta, setMeta } = useBillingStore();

  return (
    <motion.div
      initial={{ opacity: 0, y: -3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="flex items-stretch border-b border-slate-200 bg-white flex-shrink-0 overflow-x-auto no-scrollbar"
      style={{ minHeight: "var(--header-height, 64px)", maxHeight: "var(--header-height, 64px)" }}
    >

      {/* Bill Date */}
      <div
        className="flex items-center gap-2.5 px-4 py-2 flex-shrink-0 min-w-[160px]"
        style={{ background: "linear-gradient(135deg, #1a56db 0%, #1e40af 100%)" }}
      >
        <motion.div
          whileHover={{ scale: 1.08, rotate: -5 }}
          transition={{ type: "spring", stiffness: 500, damping: 28 }}
          className="w-9 h-9 rounded-full bg-white/20 ring-1 ring-white/25 flex items-center justify-center flex-shrink-0"
        >
          <Calendar className="w-4.5 h-4.5 text-white" strokeWidth={1.8} />
        </motion.div>
        <div>
          <p className="text-[10px] font-semibold text-blue-200 uppercase tracking-widest leading-none mb-1">
            Bill Date
          </p>
          <button className="flex items-center gap-1 group">
            <span className="text-[15px] font-bold text-white tabnum leading-none">
              {format(new Date(), "dd/MM/yyyy")}
            </span>
            <ChevronDown className="w-3 h-3 text-white/50 group-hover:text-white transition-colors" />
          </button>
        </div>
      </div>

      <Divider />

      {/* Customer */}
      <div className="flex items-center gap-2.5 px-3.5 py-2 flex-1 min-w-[200px] input-glow glow-focus">
        <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-white" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <input
            type="text"
            value={meta.customerName}
            onChange={(e) => setMeta({ customerName: e.target.value })}
            placeholder="Customer Mobile / Name / Card Number"
            autoComplete="off"
            className="w-full text-[14px] font-medium text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none leading-tight"
          />
          <div className="flex items-center gap-1.5 mt-0.5">
            {!meta.customerName ? (
              <>
                <button className="text-[11px] text-blue-500 hover:text-blue-700 font-medium transition-colors leading-none">
                  Create as Counter Bill
                </button>
                <MoreHorizontal className="w-3 h-3 text-slate-400" />
              </>
            ) : (
              <button
                onClick={() => setMeta({ customerName: "", customerPhone: "" })}
                className="text-[11px] text-slate-400 hover:text-red-500 transition-colors leading-none"
              >
                Clear ×
              </button>
            )}
          </div>
        </div>
      </div>

      <Divider />

      {/* Billing For */}
      <div className="flex items-center gap-2.5 px-3.5 py-2 flex-shrink-0 min-w-[140px] input-glow glow-focus">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest leading-none mb-1">
            Billing for
          </p>
          <div className="relative flex items-center gap-0.5">
            <select
              value={
                meta.paymentStatus === "PAID"    ? "Self"      :
                meta.paymentStatus === "PENDING" ? "Credit"    :
                meta.paymentStatus === "PARTIAL" ? "Insurance" : "Counter"
              }
              onChange={(e) => {
                const map: Record<string, "PAID" | "PENDING" | "PARTIAL"> = {
                  Self: "PAID", Counter: "PAID", Credit: "PENDING", Insurance: "PARTIAL",
                };
                setMeta({ paymentStatus: map[e.target.value] ?? "PAID" });
              }}
              className="text-[14px] font-bold text-blue-600 bg-transparent focus:outline-none cursor-pointer appearance-none pr-4"
            >
              {BILLING_FOR_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-blue-500 pointer-events-none absolute right-0" />
          </div>
        </div>
      </div>

      <Divider />

      {/* Doctor */}
      <div className="flex items-center gap-2.5 px-3.5 py-2 flex-1 min-w-[200px] input-glow glow-focus">
        <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
          <Stethoscope className="w-4 h-4 text-white" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest leading-none mb-1">
            Doctor
          </p>
          <input
            type="text"
            value={meta.doctorName}
            onChange={(e) => setMeta({ doctorName: e.target.value })}
            placeholder="Name / Lic No. / Mobile"
            autoComplete="off"
            className="w-full text-[14px] font-medium text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none leading-tight"
          />
        </div>
        <Search className="w-4 h-4 text-slate-300 flex-shrink-0" />
      </div>

    </motion.div>
  );
}
