"use client";

import { useState } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { Plus, Check, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const RECENT_MEDICINES = [
  { name: "Paracetamol 650", generic: "Paracetamol", freq: 12, color: "blue" },
  { name: "Amoxicillin 500", generic: "Amoxicillin", freq: 8,  color: "violet" },
  { name: "Azithromycin 500", generic: "Azithromycin", freq: 6, color: "indigo" },
  { name: "Cetirizine 10mg",  generic: "Cetirizine", freq: 5,  color: "sky" },
  { name: "Pantoprazole 40",  generic: "Pantoprazole", freq: 4, color: "teal" },
];

const FREQ_COLOR: Record<string, string> = {
  blue:   "bg-blue-100 text-blue-600",
  violet: "bg-violet-100 text-violet-600",
  indigo: "bg-indigo-100 text-indigo-600",
  sky:    "bg-sky-100 text-sky-600",
  teal:   "bg-teal-100 text-teal-600",
};

const FREQ_BTN: Record<string, string> = {
  blue:   "group-hover:bg-blue-500",
  violet: "group-hover:bg-violet-500",
  indigo: "group-hover:bg-indigo-500",
  sky:    "group-hover:bg-sky-500",
  teal:   "group-hover:bg-teal-500",
};

// Stagger container
const listVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};
const itemVariants: Variants = {
  hidden:   { opacity: 0, y: 8, scale: 0.97 },
  visible:  { opacity: 1, y: 0, scale: 1, transition: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as [number,number,number,number] } },
};

function SkeletonItem() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="skeleton h-4 flex-1 rounded-lg" />
      <div className="skeleton w-6 h-6 rounded-full" />
    </div>
  );
}

export function RecentItemsCard({ loading = false }: { loading?: boolean }) {
  const [added, setAdded] = useState<Set<string>>(new Set());

  function handleAdd(name: string) {
    setAdded((prev) => new Set(prev).add(name));
    setTimeout(() => setAdded((prev) => { const s = new Set(prev); s.delete(name); return s; }), 1800);
    // TODO: addItem from billing store when connected to API
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-card overflow-hidden card-glow-hover">

      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-amber-50 flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-amber-500" strokeWidth={2.2} />
          </div>
          <h3 className="text-sm font-semibold text-slate-800">Quick Add</h3>
        </div>
        <button className="text-[11px] text-blue-500 hover:text-blue-700 font-semibold transition-colors hover-lift px-2 py-0.5 rounded-lg hover:bg-blue-50">
          View All
        </button>
      </div>

      {/* List */}
      <div className="p-2">
        {loading ? (
          <div className="space-y-1">
            {[...Array(5)].map((_, i) => <SkeletonItem key={i} />)}
          </div>
        ) : (
          <motion.ul
            variants={listVariants}
            initial="hidden"
            animate="visible"
            className="space-y-0.5"
          >
            {RECENT_MEDICINES.map(({ name, generic, freq, color }) => {
              const isAdded = added.has(name);
              return (
                <motion.li key={name} variants={itemVariants}>
                  <motion.button
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    onClick={() => handleAdd(name)}
                    className={cn(
                      "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl",
                      "transition-all duration-150 text-left group",
                      "hover:shadow-[0_2px_12px_-2px_rgba(59,130,246,0.12)]",
                      isAdded ? "bg-emerald-50" : "hover:bg-slate-50"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className={cn(
                        "text-xs font-semibold truncate transition-colors",
                        isAdded ? "text-emerald-700" : "text-slate-700 group-hover:text-blue-700"
                      )}>
                        {name}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate mt-0.5">{generic}</p>
                    </div>

                    {/* Frequency badge */}
                    <span className={cn(
                      "pill text-[9px] flex-shrink-0 tabnum",
                      FREQ_COLOR[color] ?? "bg-slate-100 text-slate-500"
                    )}>
                      {freq}×
                    </span>

                    {/* Add / check button */}
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={isAdded ? "check" : "plus"}
                        initial={{ scale: 0, rotate: -90, opacity: 0 }}
                        animate={{ scale: 1, rotate: 0, opacity: 1 }}
                        exit={{ scale: 0, rotate: 90, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 500, damping: 28 }}
                        className={cn(
                          "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors duration-150",
                          isAdded
                            ? "bg-emerald-500"
                            : cn("bg-slate-100", FREQ_BTN[color])
                        )}
                      >
                        {isAdded
                          ? <Check className="w-3 h-3 text-white" strokeWidth={2.5} />
                          : <Plus className="w-3 h-3 text-slate-500 group-hover:text-white transition-colors" strokeWidth={2.5} />
                        }
                      </motion.div>
                    </AnimatePresence>
                  </motion.button>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </div>
    </div>
  );
}
