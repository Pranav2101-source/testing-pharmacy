"use client";

import { useCallback, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { X, Info, Pencil } from "lucide-react";
import { useBillingStore, type CartItem } from "./useBillingStore";
import { EmptyBillState } from "./EmptyBillState";
import { cn } from "@/lib/utils";

// 12 cols (no row-number): ItemName | Unit | Loc | Batch | Expiry | MRP | Qty | D% | D.Price | GST% | Amount | Del
const COL = "grid-cols-[minmax(220px,1fr)_88px_64px_108px_76px_84px_76px_68px_96px_68px_108px_40px]";

// ─────────────────────────────────────────────────────────────────
// Table header — accepts lifa props from page
// ─────────────────────────────────────────────────────────────────
export function CartTableHeader({
  lifa,
  onLifaToggle,
}: {
  lifa: boolean;
  onLifaToggle: () => void;
}) {
  const TH = "text-[12px] font-bold text-slate-500 uppercase tracking-wide text-right px-3 py-3 select-none whitespace-nowrap";

  return (
    <div className={cn("grid items-center", COL)}>

      {/* Item Name col — has LIFA/LILA toggle inline */}
      <div className="flex items-center justify-between px-3 py-3">
        <span className="flex items-center gap-1 text-[12px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">
          Item Name
          <Info className="w-3.5 h-3.5 text-slate-400" />
        </span>

        {/* LIFA / LILA toggle */}
        <button
          onClick={onLifaToggle}
          title={lifa ? "Switch to LILA" : "Switch to LIFA"}
          className="flex items-center gap-1.5 ml-3"
        >
          <span className={cn(
            "text-[12px] font-bold uppercase tracking-widest transition-colors",
            lifa ? "text-blue-600" : "text-slate-400"
          )}>
            LIFA
          </span>
          <div className={cn(
            "w-10 h-5 rounded-full relative transition-colors duration-200",
            lifa ? "bg-blue-500" : "bg-slate-300"
          )}>
            <motion.span
              layout
              transition={{ type: "spring", stiffness: 600, damping: 35 }}
              className={cn(
                "absolute top-[4px] w-3 h-3 rounded-full bg-white shadow-sm",
                lifa ? "left-[22px]" : "left-[4px]"
              )}
            />
          </div>
          <span className={cn(
            "text-[12px] font-bold uppercase tracking-widest transition-colors",
            !lifa ? "text-blue-600" : "text-slate-400"
          )}>
            LILA
          </span>
        </button>
      </div>

      {/* Remaining headers */}
      <span className={cn(TH, "text-left")}>Unit/Pack</span>
      <span className={cn(TH, "text-left")}>Loc.</span>
      <span className={TH}>Batch</span>
      <span className={TH}>Expiry</span>
      <span className={TH}>MRP</span>

      <span className={cn(TH, "flex items-center justify-end gap-0.5")}>
        Qty.
        <Info className="w-3.5 h-3.5 text-slate-400 inline" />
      </span>

      <span className={cn(TH, "flex items-center justify-end gap-0.5")}>
        <Pencil className="w-3.5 h-3.5 text-slate-400 inline" />
        D%
        <Info className="w-3.5 h-3.5 text-slate-400 inline" />
      </span>

      <span className={TH}>D.Price</span>

      <span className={cn(TH, "flex items-center justify-end gap-0.5")}>
        GST%
        <Info className="w-3.5 h-3.5 text-slate-400 inline" />
      </span>

      <span className={TH}>Amount</span>
      <span className={TH} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Skeleton row
// ─────────────────────────────────────────────────────────────────
function SkeletonRow({ idx }: { idx: number }) {
  return (
    <div className={cn(
      "grid items-center border-b border-slate-100 py-3",
      COL,
      idx % 2 === 1 ? "bg-slate-50/40" : "bg-white"
    )}>
      <div className="px-3 space-y-2">
        <div className="skeleton h-4 w-40 rounded-md" />
        <div className="skeleton h-2.5 w-24 rounded-md" />
      </div>
      {[88, 64, 108, 76, 84, 76, 68, 96, 68, 108].map((w, i) => (
        <div key={i} className="px-3 flex justify-end">
          <div className="skeleton h-3.5 rounded-md" style={{ width: w * 0.48 }} />
        </div>
      ))}
      <div />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Cart Row — memoized
// ─────────────────────────────────────────────────────────────────
const CartRow = memo(function CartRow({
  item,
  idx,
  onKeyNav,
  onRemove,
  onQtyChange,
  onDiscountChange,
}: {
  item: CartItem;
  idx: number;
  onKeyNav: (e: React.KeyboardEvent<HTMLInputElement>, idx: number, col: "qty" | "dis") => void;
  onRemove: (id: string) => void;
  onQtyChange: (id: string, qty: number) => void;
  onDiscountChange: (id: string, discount: number) => void;
}) {
  const isExpired      = new Date(item.expiryDate) < new Date();
  const isExpiringSoon = !isExpired && new Date(item.expiryDate) < new Date(Date.now() + 90 * 86400000);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
      className={cn(
        "grid items-center border-b border-slate-100 group",
        "transition-colors duration-100",
        "hover:bg-blue-50/40 hover:shadow-[inset_3px_0_0_0_#2563eb]",
        COL,
        idx % 2 === 1 ? "bg-slate-50/30" : "bg-white"
      )}
    >
      {/* Item Name */}
      <div className="px-3 py-3 min-w-0">
        <p className="text-[15px] font-semibold text-slate-800 truncate leading-snug">
          {item.medicineName}
        </p>
        {item.hsnCode && (
          <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5">HSN {item.hsnCode}</p>
        )}
      </div>

      {/* Unit/Pack */}
      <span className={cn(
        "px-3 py-3 text-[14px] text-left truncate",
        item.packSize ? "text-slate-600 font-medium" : "text-slate-300"
      )}>
        {item.packSize ?? "—"}
      </span>

      {/* Loc. */}
      <span className={cn(
        "px-3 py-3 text-[14px] text-left truncate",
        item.location ? "text-slate-600 font-medium" : "text-slate-300"
      )}>
        {item.location ?? "—"}
      </span>

      {/* Batch */}
      <span className="px-3 py-3 text-[14px] text-slate-600 text-right font-mono truncate">
        {item.batchNumber}
      </span>

      {/* Expiry */}
      <span className={cn(
        "px-3 py-3 text-[14px] text-right font-semibold tabnum",
        isExpired      ? "text-red-500"   :
        isExpiringSoon ? "text-amber-500" : "text-slate-500"
      )}>
        {format(new Date(item.expiryDate), "MM/yy")}
      </span>

      {/* MRP */}
      <span className="px-3 py-3 text-[15px] text-slate-700 text-right font-medium tabnum">
        {item.mrp.toFixed(2)}
      </span>

      {/* Qty */}
      <div className="px-1.5 py-2">
        <input
          type="number"
          min={1}
          value={item.quantity}
          data-row={idx}
          data-col="qty"
          onChange={(e) => onQtyChange(item.inventoryId, Number(e.target.value))}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => onKeyNav(e, idx, "qty")}
          className={cn(
            "w-full text-center text-[15px] font-bold tabnum",
            "border border-slate-200 rounded-md px-1.5 py-2",
            "focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400",
            "bg-white hover:border-blue-300 transition-all duration-100"
          )}
        />
      </div>

      {/* D% */}
      <div className="px-1.5 py-2">
        <input
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={item.discount}
          data-row={idx}
          data-col="dis"
          onChange={(e) => onDiscountChange(item.inventoryId, Number(e.target.value))}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => onKeyNav(e, idx, "dis")}
          className={cn(
            "w-full text-center text-[15px] tabnum",
            "border border-slate-200 rounded-md px-1.5 py-2",
            "focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-400",
            "bg-white hover:border-rose-300 transition-all duration-100",
            item.discount > 0 ? "text-rose-600 font-semibold" : "text-slate-600"
          )}
        />
      </div>

      {/* D.Price */}
      <span className="px-3 py-3 text-[15px] text-slate-700 text-right tabnum">
        {item.rate.toFixed(2)}
      </span>

      {/* GST% */}
      <span className="px-3 py-3 text-[14px] text-slate-500 text-right tabnum">
        {item.gstRate}%
      </span>

      {/* Amount */}
      <motion.span
        key={item.amount}
        initial={{ scale: 0.88, opacity: 0.5 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className="px-3 py-3 text-[16px] font-bold text-slate-900 text-right tabnum block"
      >
        {item.amount.toFixed(2)}
      </motion.span>

      {/* Delete */}
      <div className="flex justify-center">
        <motion.button
          whileHover={{ scale: 1.15 }}
          whileTap={{ scale: 0.88 }}
          onClick={() => onRemove(item.inventoryId)}
          tabIndex={-1}
          className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-md bg-red-50 hover:bg-red-500 text-red-400 hover:text-white flex items-center justify-center transition-all duration-150"
        >
          <X className="w-4 h-4" />
        </motion.button>
      </div>
    </motion.div>
  );
});

// ─────────────────────────────────────────────────────────────────
// CartTableRows
// ─────────────────────────────────────────────────────────────────
export function CartTableRows({ showSkeleton = false }: { showSkeleton?: boolean }) {
  const { items, removeItem, updateQty, updateDiscount } = useBillingStore();

  const handleKeyNav = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, idx: number, col: "qty" | "dis") => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>(`[data-row="${idx + 1}"][data-col="${col}"]`);
        el?.focus(); el?.select();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>(`[data-row="${idx - 1}"][data-col="${col}"]`);
        el?.focus(); el?.select();
      } else if (e.key === "Tab" && !e.shiftKey && col === "dis") {
        const next = document.querySelector<HTMLInputElement>(`[data-row="${idx + 1}"][data-col="qty"]`);
        if (next) { e.preventDefault(); next.focus(); next.select(); }
      } else if (e.key === "Enter" && col === "qty") {
        e.preventDefault();
        const dis = document.querySelector<HTMLInputElement>(`[data-row="${idx}"][data-col="dis"]`);
        dis?.focus(); dis?.select();
      } else if (e.key === "Enter" && col === "dis") {
        e.preventDefault();
        const next = document.querySelector<HTMLInputElement>(`[data-row="${idx + 1}"][data-col="qty"]`);
        if (next) { next.focus(); next.select(); }
        else document.querySelector<HTMLInputElement>("[data-billing-search]")?.focus();
      }
    },
    []
  );

  if (showSkeleton) {
    return (
      <div className="overflow-y-auto overflow-x-auto flex-1">
        <div className="min-w-max">
          {[0, 1, 2].map((i) => <SkeletonRow key={i} idx={i} />)}
        </div>
      </div>
    );
  }

  if (items.length === 0) return <EmptyBillState />;

  return (
    <div className="overflow-y-auto overflow-x-auto flex-1">
      <div className="min-w-max">
        <AnimatePresence initial={false}>
          {items.map((item, idx) => (
            <CartRow
              key={item.inventoryId}
              item={item}
              idx={idx}
              onKeyNav={handleKeyNav}
              onRemove={removeItem}
              onQtyChange={updateQty}
              onDiscountChange={updateDiscount}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
