"use client";

import { motion, AnimatePresence } from "framer-motion";
import { UserPlus, Phone, User } from "lucide-react";
import { useBillingStore } from "./useBillingStore";

export function CustomerInfoCard() {
  const { meta, setMeta } = useBillingStore();

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-card overflow-hidden card-glow-hover">
      <div className="px-4 py-3 border-b border-slate-50 flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-blue-50 flex items-center justify-center">
          <User className="w-3.5 h-3.5 text-blue-500" strokeWidth={2} />
        </div>
        <h3 className="text-sm font-semibold text-slate-800">Customer Info</h3>
      </div>

      <div className="px-4 py-3">
        <AnimatePresence mode="wait">
          {meta.customerName ? (
            <motion.div
              key="customer"
              initial={{ opacity: 0, scale: 0.95, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="flex items-center gap-3"
            >
              <motion.div
                initial={{ scale: 0, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
                className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-bold text-sm shadow-md flex-shrink-0"
              >
                {meta.customerName.charAt(0).toUpperCase()}
              </motion.div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-800 truncate">{meta.customerName}</p>
                {meta.customerPhone && (
                  <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                    <Phone className="w-3 h-3" /> {meta.customerPhone}
                  </p>
                )}
                <button
                  onClick={() => setMeta({ customerId: "", customerName: "", customerPhone: "", customerDefaultDiscount: 0 })}
                  className="text-[10px] text-red-400 hover:text-red-600 font-semibold mt-1 transition-colors"
                >
                  Remove ×
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="space-y-2.5"
            >
              <p className="text-xs text-slate-400">Walk-in / Counter Sale</p>

              {/* Phone input with glow */}
              <div className="glow-focus rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2">
                  <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                  <input
                    type="tel"
                    value={meta.customerPhone}
                    onChange={(e) => setMeta({ customerPhone: e.target.value })}
                    placeholder="Enter phone number"
                    className="flex-1 text-sm text-slate-700 placeholder-slate-300 bg-transparent focus:outline-none"
                  />
                </div>
              </div>

              <motion.button
                whileHover={{ y: -1, boxShadow: "0 4px 12px -2px rgba(59,130,246,0.2)" }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border-2 border-dashed border-blue-200 text-blue-600 hover:bg-blue-50 hover:border-blue-300 text-xs font-semibold transition-colors duration-150"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Add Customer
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
