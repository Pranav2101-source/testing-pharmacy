"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { Plus, Check, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import { useBillingStore } from "./useBillingStore";
import { expiryStatus, getLocationLabel, fmtExpiry } from "./BatchPickerDialog";

type FrequentBatch = {
  id:               string;
  batchNumber:      string;
  expiryDate:       string;
  mrp:              number;
  quantity:         number;
  reservedQuantity: number;
  location:         string | null;
  shelf:            { code: string; rack: { code: string; name: string } } | null;
  freq:             number;
  medicine: {
    name:        string;
    genericName: string | null;
    hsnCode:     string | null;
    gstRate:     number;
    isActive:    boolean;
    schedule:    string | null;
    packSize:    string | null;
  };
};

const PALETTE = ["blue", "violet", "indigo", "sky", "teal", "amber", "rose", "emerald", "orange", "purple"] as const;

const FREQ_COLOR: Record<string, string> = {
  blue:    "bg-blue-100 text-blue-600",
  violet:  "bg-violet-100 text-violet-600",
  indigo:  "bg-indigo-100 text-indigo-600",
  sky:     "bg-sky-100 text-sky-600",
  teal:    "bg-teal-100 text-teal-600",
  amber:   "bg-amber-100 text-amber-600",
  rose:    "bg-rose-100 text-rose-600",
  emerald: "bg-emerald-100 text-emerald-600",
  orange:  "bg-orange-100 text-orange-600",
  purple:  "bg-purple-100 text-purple-600",
};

const FREQ_BTN: Record<string, string> = {
  blue:    "group-hover:bg-blue-500",
  violet:  "group-hover:bg-violet-500",
  indigo:  "group-hover:bg-indigo-500",
  sky:     "group-hover:bg-sky-500",
  teal:    "group-hover:bg-teal-500",
  amber:   "group-hover:bg-amber-500",
  rose:    "group-hover:bg-rose-500",
  emerald: "group-hover:bg-emerald-500",
  orange:  "group-hover:bg-orange-500",
  purple:  "group-hover:bg-purple-500",
};

const listVariants: Variants = {
  hidden:  {},
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

export function RecentItemsCard() {
  const addItem = useBillingStore((s) => s.addItem);
  const [added, setAdded]     = useState<Set<string>>(new Set());
  const [errMsg, setErrMsg]   = useState<string>("");

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["inventory-frequent"],
    queryFn:  () =>
      api.get<{ data: FrequentBatch[] }>("/inventory/frequent")
        .then((r) => r.data.data),
    staleTime: 5 * 60_000,
  });

  function handleAdd(batch: FrequentBatch) {
    const status = expiryStatus(batch.expiryDate);
    if (status.color === "red") {
      setErrMsg(`${batch.medicine.name} — batch ${batch.batchNumber} expired ${fmtExpiry(batch.expiryDate)}.`);
      setTimeout(() => setErrMsg(""), 3000);
      return;
    }

    addItem({
      inventoryId:    batch.id,
      medicineName:   batch.medicine.name,
      hsnCode:        batch.medicine.hsnCode,
      schedule:       batch.medicine.schedule,
      packSize:       batch.medicine.packSize ?? undefined,
      location:       getLocationLabel(batch) ?? undefined,
      batchNumber:    batch.batchNumber,
      expiryDate:     batch.expiryDate,
      mrp:            batch.mrp,
      quantity:       1,
      discount:       0,
      gstRate:        batch.medicine.gstRate,
      availableStock: batch.quantity - (batch.reservedQuantity ?? 0),
    });

    setAdded((prev) => new Set(prev).add(batch.id));
    setTimeout(() => setAdded((prev) => { const s = new Set(prev); s.delete(batch.id); return s; }), 1800);
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
        {errMsg && (
          <span className="text-[10px] text-red-500 truncate max-w-[160px]">{errMsg}</span>
        )}
      </div>

      {/* List */}
      <div className="p-2">
        {isLoading ? (
          <div className="space-y-1">
            {[...Array(5)].map((_, i) => <SkeletonItem key={i} />)}
          </div>
        ) : items.length === 0 ? (
          <p className="text-[11px] text-slate-400 text-center py-4 px-3">
            Quick Add will appear here after your first few bills.
          </p>
        ) : (
          <motion.ul
            variants={listVariants}
            initial="hidden"
            animate="visible"
            className="space-y-0.5"
          >
            {items.map((batch, idx) => {
              const color   = PALETTE[idx % PALETTE.length] ?? "blue";
              const isAdded = added.has(batch.id);
              return (
                <motion.li key={batch.id} variants={itemVariants}>
                  <motion.button
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    onClick={() => handleAdd(batch)}
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
                        {batch.medicine.name}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate mt-0.5">
                        {batch.medicine.genericName ?? batch.batchNumber}
                      </p>
                    </div>

                    {/* Frequency badge */}
                    <span className={cn(
                      "pill text-[9px] flex-shrink-0 tabnum",
                      FREQ_COLOR[color] ?? "bg-slate-100 text-slate-500"
                    )}>
                      {batch.freq}×
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
