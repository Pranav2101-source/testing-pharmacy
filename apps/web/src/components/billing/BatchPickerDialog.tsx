"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { X, Clock, Layers, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export type InventoryBatch = {
  id:               string;
  batchNumber:      string;
  expiryDate:       string;
  mrp:              number;
  quantity:         number;
  reservedQuantity?: number;
  location?:        string;
  shelf?:           { code: string; rack: { code: string; name: string } };
  medicine: {
    name:     string;
    hsnCode:  string | null;
    gstRate:  number;
    isActive: boolean;
  };
};

/** Returns a display-ready location string from either structured shelf or free-text. */
export function getLocationLabel(
  batch: Pick<InventoryBatch, "shelf" | "location">,
): string | null {
  if (batch.shelf) return `${batch.shelf.rack.code}/${batch.shelf.code}`;
  if (batch.location) return batch.location;
  return null;
}

export function expiryStatus(isoDate: string) {
  const ms   = new Date(isoDate).getTime() - Date.now();
  const days = Math.ceil(ms / 86400000);
  if (days <= 0)  return { label: "EXPIRED",  days, color: "red"   } as const;
  if (days <= 30) return { label: "CRITICAL", days, color: "red"   } as const;
  if (days <= 90) return { label: "EXPIRING", days, color: "amber" } as const;
  return            { label: "OK",        days, color: "green" } as const;
}

export function fmtExpiry(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export const BatchPickerDialog = memo(function BatchPickerDialog({
  medicineName,
  batches,
  onSelect,
  onClose,
}: {
  medicineName: string;
  batches:      InventoryBatch[];
  onSelect:     (batch: InventoryBatch) => void;
  onClose:      () => void;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 bg-gradient-to-br from-blue-50/80 to-white">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0 shadow-sm shadow-blue-200">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-0.5">Select a Batch</p>
            <p className="font-bold text-slate-900 text-[15px] truncate">{medicineName}</p>
            <p className="text-[11px] text-slate-400">
              {batches.length} batch{batches.length !== 1 ? "es" : ""} available · FIFO order
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center flex-shrink-0 transition-colors"
          >
            <X className="w-3.5 h-3.5 text-slate-500" />
          </button>
        </div>

        {/* Batch list */}
        <div className="p-2 max-h-[420px] overflow-y-auto">
          {batches.map((batch) => {
            const status       = expiryStatus(batch.expiryDate);
            const discontinued = !batch.medicine.isActive;
            const isDisabled   = status.color === "red" || discontinued;
            const locationLabel = getLocationLabel(batch);
            const available     = batch.quantity - (batch.reservedQuantity ?? 0);

            return (
              <button
                key={batch.id}
                onClick={() => !isDisabled && onSelect(batch)}
                disabled={isDisabled}
                className={cn(
                  "w-full flex items-start gap-3 px-4 py-3 rounded-xl transition-colors text-left mb-0.5",
                  isDisabled
                    ? "opacity-50 cursor-not-allowed bg-slate-50"
                    : "hover:bg-blue-50 active:bg-blue-100 cursor-pointer"
                )}
              >
                {/* Expiry colour bar */}
                <div className={cn(
                  "w-1 self-stretch rounded-full flex-shrink-0 mt-0.5",
                  status.color === "red"   ? "bg-red-400"   :
                  status.color === "amber" ? "bg-amber-400" : "bg-emerald-400"
                )} />

                <div className="flex-1 min-w-0">
                  {/* Batch number + status badges */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[13px] text-slate-800">
                      Batch {batch.batchNumber}
                    </span>
                    {discontinued && (
                      <span className="text-[9px] font-bold bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                        Discontinued
                      </span>
                    )}
                    {!discontinued && status.label === "EXPIRED" && (
                      <span className="text-[9px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                        Expired
                      </span>
                    )}
                    {!discontinued && status.label === "CRITICAL" && (
                      <span className="text-[9px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                        {status.days}d left
                      </span>
                    )}
                    {!discontinued && status.label === "EXPIRING" && (
                      <span className="text-[9px] font-bold bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                        {status.days}d left
                      </span>
                    )}
                  </div>

                  {/* Expiry + location row */}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="flex items-center gap-1 text-[11px] text-slate-400">
                      <Clock className="w-3 h-3" />
                      {fmtExpiry(batch.expiryDate)}
                    </span>
                    {locationLabel ? (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">
                        <MapPin className="w-2.5 h-2.5" />
                        {locationLabel}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-300 italic">No location</span>
                    )}
                  </div>
                </div>

                {/* Price + stock */}
                <div className="text-right flex-shrink-0">
                  <div className="font-bold text-[14px] text-slate-800">₹{batch.mrp.toFixed(2)}</div>
                  <div className={cn(
                    "text-[11px] font-semibold mt-0.5",
                    available === 0 ? "text-red-500" :
                    available <= 5  ? "text-red-500" :
                    available <= 20 ? "text-amber-500" : "text-emerald-600"
                  )}>
                    {available} avail.
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
});
