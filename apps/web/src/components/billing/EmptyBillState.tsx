"use client";

import { motion } from "framer-motion";
import { Pill, Search, ScanBarcode, Cross } from "lucide-react";

export function EmptyBillState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="flex flex-col items-center justify-center flex-1 py-10 select-none"
    >
      {/* Illustration — on-brand icon composition, no external network image */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="relative w-28 h-28 mb-5"
      >
        <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-blue-100 via-indigo-50 to-violet-100" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-200 flex items-center justify-center -rotate-6">
            <Pill className="w-8 h-8 text-white" strokeWidth={2} />
          </div>
        </div>
        <div className="absolute -top-1.5 -right-1.5 w-8 h-8 rounded-full bg-emerald-500 shadow-md flex items-center justify-center ring-4 ring-white">
          <ScanBarcode className="w-4 h-4 text-white" />
        </div>
        {/* Pharmacy mark — cross + capsule concept: the capsule (Pill) is the dominant
            shape above; this badge completes it with the pharmacy cross. */}
        <div className="absolute -bottom-1 -left-2 w-7 h-7 rounded-full bg-purple-700 shadow-md flex items-center justify-center ring-4 ring-white">
          <Cross className="w-3.5 h-3.5 text-white" />
        </div>
      </motion.div>

      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.3 }}
        className="text-[17px] font-bold text-slate-700 text-center"
      >
        Search medicine to add items to bill
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.28, duration: 0.3 }}
        className="flex items-center gap-2 mt-4 flex-wrap justify-center max-w-md"
      >
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-3 py-1.5">
          <Search className="w-3 h-3 text-slate-400" />
          Name or generic name
        </span>
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1.5">
          <ScanBarcode className="w-3 h-3 text-emerald-500" />
          Scan a barcode
        </span>
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-3 py-1.5">
          Press{" "}
          <kbd className="text-[10px] bg-white border border-slate-200 rounded px-1.5 py-0.5 font-mono text-slate-600">
            Enter
          </kbd>{" "}
          to add first result
        </span>
      </motion.div>
    </motion.div>
  );
}
