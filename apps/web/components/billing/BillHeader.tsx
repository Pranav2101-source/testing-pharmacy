"use client";

import { format } from "date-fns";
import { Calendar, User, Stethoscope, Search, ChevronDown, MoreHorizontal } from "lucide-react";
import { motion } from "framer-motion";
import { useBillingStore } from "./useBillingStore";
import { cn } from "@/lib/utils";

const BILLING_FOR_OPTIONS = ["Self", "Counter", "Credit", "Insurance"] as const;

// ── Circular icon badge (matching reference) ─────────────────────
function CircleIcon({
  icon: Icon,
  size = "md",
  className,
}: {
  icon: React.ElementType;
  size?: "sm" | "md";
  className?: string;
}) {
  const dim = size === "md" ? "w-11 h-11" : "w-8 h-8";
  const ico = size === "md" ? "w-6 h-6" : "w-4 h-4";
  return (
    <div className={cn("rounded-full flex items-center justify-center flex-shrink-0", dim, className)}>
      <Icon className={ico} strokeWidth={2} />
    </div>
  );
}

// ── Divider ──────────────────────────────────────────────────────
function Divider() {
  return <div className="w-px self-stretch bg-slate-100 flex-shrink-0" />;
}

export function BillHeader() {
  const { meta, setMeta } = useBillingStore();

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-stretch border-b border-slate-200 bg-white flex-shrink-0 overflow-x-auto no-scrollbar"
      style={{ minHeight: "80px" }}
    >

      {/* ── Bill Date — blue background ───────────────────────── */}
      <div
        className="flex items-center gap-3 px-5 py-3 flex-shrink-0 min-w-[175px]"
        style={{ background: "linear-gradient(135deg, #1a56db 0%, #1e40af 100%)" }}
      >
        <motion.div
          whileHover={{ scale: 1.06, rotate: -5 }}
          transition={{ type: "spring", stiffness: 500, damping: 28 }}
        >
          <CircleIcon
            icon={Calendar}
            className="bg-white/20 text-white ring-1 ring-white/25"
          />
        </motion.div>
        <div>
          <p className="text-[12px] font-semibold text-blue-200 uppercase tracking-widest leading-none mb-1">
            Bill Date
          </p>
          <button className="flex items-center gap-1 group">
            <span className="text-[18px] font-bold text-white tabnum leading-none">
              {format(new Date(), "dd/MM/yyyy")}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-white/50 group-hover:text-white transition-colors" />
          </button>
        </div>
      </div>

      <Divider />

      {/* ── Customer ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 flex-1 min-w-[220px] input-glow glow-focus">
        <CircleIcon icon={User} className="bg-blue-500 text-white flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <input
            type="text"
            value={meta.customerName}
            onChange={(e) => setMeta({ customerName: e.target.value })}
            placeholder="Customer Mobile / Name / Card Number"
            className="w-full text-[16px] font-medium text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none leading-none"
          />
          <div className="flex items-center gap-2 mt-1.5">
            {!meta.customerName ? (
              <>
                <button className="text-[13px] text-blue-500 hover:text-blue-700 font-medium transition-colors">
                  Create as Counter Bill
                </button>
                <MoreHorizontal className="w-3.5 h-3.5 text-slate-400" />
              </>
            ) : (
              <button
                onClick={() => setMeta({ customerName: "", customerPhone: "" })}
                className="text-[11px] text-slate-400 hover:text-red-500 transition-colors"
              >
                Clear ×
              </button>
            )}
          </div>
        </div>
      </div>

      <Divider />

      {/* ── Billing For ───────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0 min-w-[160px] input-glow glow-focus">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-widest leading-none mb-1.5">
            Billing for
          </p>
          <div className="relative flex items-center gap-1">
            <select
              value={meta.paymentStatus === "PAID" ? "Self" : meta.paymentStatus === "PENDING" ? "Credit" : meta.paymentStatus === "PARTIAL" ? "Insurance" : "Counter"}
              onChange={(e) => {
                const map: Record<string, "PAID" | "PENDING" | "PARTIAL"> = {
                  Self: "PAID",
                  Counter: "PAID",
                  Credit: "PENDING",
                  Insurance: "PARTIAL",
                };
                setMeta({ paymentStatus: map[e.target.value] ?? "PAID" });
              }}
              className="text-[16px] font-bold text-blue-600 bg-transparent focus:outline-none cursor-pointer appearance-none pr-5"
            >
              {BILLING_FOR_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <ChevronDown className="w-4 h-4 text-blue-500 pointer-events-none absolute right-0" />
          </div>
        </div>
      </div>

      <Divider />

      {/* ── Doctor ────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 flex-1 min-w-[220px] input-glow glow-focus">
        <CircleIcon icon={Stethoscope} className="bg-blue-500 text-white flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-widest leading-none mb-1">
            Doctor
          </p>
          <input
            type="text"
            value={meta.doctorName}
            onChange={(e) => setMeta({ doctorName: e.target.value })}
            placeholder="Enter Doctor (Name / Lic No. / Mobile / a,alias)"
            className="w-full text-[16px] font-medium text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none leading-none"
          />
        </div>
        <Search className="w-5 h-5 text-slate-300 flex-shrink-0" />
      </div>

    </motion.div>
  );
}
