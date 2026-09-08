"use client";

import { memo, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, Clock, Layers, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export type InventoryBatch = {
  id:               string;
  batchNumber:      string;
  expiryDate:       string;
  mrp:              number;
  quantity:         number;
  /** Loose pieces from an opened pack (cut-strip selling). 0 for pack-only stock. */
  looseUnits?:      number;
  reservedQuantity?: number;
  location?:        string;
  shelf?:           { code: string; rack: { code: string; name: string } };
  medicine: {
    name:     string;
    hsnCode:  string | null;
    gstRate:  number;
    isActive: boolean;
    /** Effective pack size (this pharmacy's override, else the catalogue's). */
    unitsPerPack?:   number | null;
    baseUnit?:       string | null;
    /** This pharmacy has enabled cut-strip selling for this medicine. */
    allowLooseSale?: boolean;
    looseByDefault?: boolean;
  };
};

/** Returns a display-ready location string from either structured shelf or free-text. */
export function getLocationLabel(
  batch: { shelf?: { code: string; rack: { code: string; name?: string } } | null; location?: string | null },
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
  lifa = false,
  onSelect,
  onClose,
}: {
  medicineName: string;
  batches:      InventoryBatch[];
  /** Display only — batches arrive pre-ordered by the caller's chosen strategy
   *  (see MedicineSearchCombobox's sortBatchesByStrategy); this just labels it correctly. */
  lifa?:        boolean;
  onSelect:     (batch: InventoryBatch) => void;
  onClose:      () => void;
}) {
  // Order is the backend dispensing engine's — GET /dispensing/batches already
  // returns these sorted by the pharmacy's configured strategy (LILA/FEFO or
  // LIFA). The picker shows that order verbatim rather than re-sorting; a
  // pharmacist picking a different row is the manual-override path.
  const sorted = batches;
  const selectable = sorted.map((b) => expiryStatus(b.expiryDate).color !== "red" && b.medicine.isActive);
  const firstSelectable = selectable.findIndex(Boolean);

  // Keyboard-first, same as the search combobox that opens this dialog: a medicine
  // with more than one batch is the pharmacy norm (restocked constantly), not the
  // exception, so forcing a reach for the mouse here broke the keyboard flow on
  // exactly the common case.
  const [cursor, setCursor] = useState(Math.max(0, firstSelectable));
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.focus();
  }, []);

  function move(delta: 1 | -1) {
    setCursor((c) => {
      let next = c;
      for (let i = 0; i < sorted.length; i++) {
        next = (next + delta + sorted.length) % sorted.length;
        if (selectable[next]) return next;
      }
      return c;
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const batch = sorted[cursor];
      if (batch && selectable[cursor]) onSelect(batch);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

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
              {batches.length} batch{batches.length !== 1 ? "es" : ""} available ·{" "}
              {lifa ? "newest first (LIFA)" : "FEFO order"} · ↑↓ then Enter
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
        <div
          ref={listRef}
          role="listbox"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className="p-2 max-h-[420px] overflow-y-auto focus:outline-none"
        >
          {sorted.map((batch, i) => {
            const status       = expiryStatus(batch.expiryDate);
            const discontinued = !batch.medicine.isActive;
            const isDisabled   = status.color === "red" || discontinued;
            const locationLabel = getLocationLabel(batch);
            const available     = batch.quantity - (batch.reservedQuantity ?? 0);
            const open          = batch.looseUnits ?? 0;
            const isCursor      = i === cursor;

            return (
              <button
                key={batch.id}
                role="option"
                aria-selected={isCursor}
                onMouseEnter={() => !isDisabled && setCursor(i)}
                onClick={() => !isDisabled && onSelect(batch)}
                disabled={isDisabled}
                className={cn(
                  "w-full flex items-start gap-3 px-4 py-3 rounded-xl transition-colors text-left mb-0.5",
                  isDisabled
                    ? "opacity-50 cursor-not-allowed bg-slate-50"
                    : isCursor
                      ? "bg-blue-100/70 ring-1 ring-blue-300"
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
                    {isCursor && !isDisabled && (
                      <span className="text-[9px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded-full uppercase tracking-wide">↵</span>
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
                  {open > 0 && (
                    <div className="text-[10px] font-bold text-amber-600 mt-0.5">{open} open</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
});
