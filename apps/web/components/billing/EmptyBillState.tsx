"use client";

import { motion } from "framer-motion";

export function EmptyBillState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="flex flex-col items-center justify-center flex-1 py-10 select-none"
    >
      {/* Floating illustration */}
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 4, ease: "easeInOut", repeat: Infinity }}
        className="relative"
      >
        {/* Glow behind SVG */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <motion.div
            animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0.5, 0.3] }}
            transition={{ duration: 4, ease: "easeInOut", repeat: Infinity }}
            className="w-28 h-28 rounded-full bg-blue-100 blur-2xl"
          />
        </div>

        <svg viewBox="0 0 200 170" className="w-44 h-36 mb-1 relative" fill="none">
          {/* Basket handle */}
          <path d="M55 90 Q100 35 145 90" stroke="#93c5fd" strokeWidth="8" strokeLinecap="round"/>
          {/* Basket body */}
          <rect x="28" y="90" width="144" height="68" rx="8" fill="#2563eb"/>
          {/* Basket grid lines */}
          {[58, 82, 106, 130].map((x) => (
            <line key={x} x1={x} y1="90" x2={x - 3} y2="158" stroke="#1d4ed8" strokeWidth="1.5" opacity="0.7"/>
          ))}
          <line x1="28" y1="113" x2="172" y2="113" stroke="#1d4ed8" strokeWidth="1.5" opacity="0.7"/>
          <line x1="28" y1="136" x2="172" y2="136" stroke="#1d4ed8" strokeWidth="1.5" opacity="0.7"/>

          {/* Tablet blister pack */}
          <rect x="40" y="70" width="40" height="24" rx="4" fill="#e2e8f0"/>
          <rect x="44" y="74" width="14" height="16" rx="7" fill="#cbd5e1"/>
          <rect x="62" y="74" width="14" height="16" rx="7" fill="#cbd5e1"/>

          {/* Syrup bottle */}
          <rect x="115" y="48" width="30" height="46" rx="4" fill="#bfdbfe"/>
          <rect x="119" y="41" width="22" height="10" rx="3" fill="#93c5fd"/>
          <rect x="119" y="62" width="22" height="12" rx="2" fill="white" opacity="0.5"/>
          <line x1="122" y1="65" x2="138" y2="65" stroke="#60a5fa" strokeWidth="1.5" opacity="0.7"/>
          <line x1="122" y1="69" x2="135" y2="69" stroke="#60a5fa" strokeWidth="1.5" opacity="0.7"/>

          {/* Strip */}
          <rect x="155" y="74" width="26" height="18" rx="3" fill="#fde68a"/>
          <circle cx="163" cy="83" r="5" fill="#fbbf24"/>
          <circle cx="176" cy="83" r="5" fill="#fbbf24"/>

          {/* Capsule */}
          <ellipse cx="72" cy="68" rx="12" ry="6" fill="#f0abfc" transform="rotate(-25 72 68)"/>
          <ellipse cx="72" cy="68" rx="6" ry="6" fill="#d946ef" transform="rotate(-25 72 68)"/>
        </svg>
      </motion.div>

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
        <kbd className="text-[12px] bg-slate-100 text-slate-500 rounded px-2 py-0.5 font-mono">Enter</kbd>{" "}
        to add first result
      </motion.p>
    </motion.div>
  );
}
