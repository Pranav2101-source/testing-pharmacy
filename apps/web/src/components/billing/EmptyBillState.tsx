"use client";

import { motion } from "framer-motion";

export function EmptyBillState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="flex flex-col items-center justify-center flex-1 py-8 select-none"
    >
      <motion.img
        src="https://plus.unsplash.com/premium_photo-1781424082427-0500e9e8d84c?q=80&w=480&auto=format&fit=crop"
        alt="Medicine basket"
        draggable={false}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-56 h-56 object-contain mb-4 drop-shadow-md"
      />

      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.3 }}
        className="text-[17px] font-semibold text-slate-600 text-center"
      >
        Search medicine to add items to bill
      </motion.p>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25, duration: 0.3 }}
        className="text-[14px] text-slate-400 mt-2 text-center"
      >
        Type name, barcode, or generic name · Press{" "}
        <kbd className="text-[12px] bg-slate-100 text-slate-500 rounded px-2 py-0.5 font-mono">
          Enter
        </kbd>{" "}
        to add first result
      </motion.p>
    </motion.div>
  );
}
