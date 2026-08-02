"use client";

import { useCallback, memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { X, AlertTriangle, MapPin } from "lucide-react";
import { useBillingStore, type CartItem } from "./useBillingStore";
import { EmptyBillState } from "./EmptyBillState";
import { RecentItemsCard } from "./RecentItemsCard";
import { BatchPickerDialog, type InventoryBatch, expiryStatus, getLocationLabel } from "./BatchPickerDialog";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// Column grid — 12 cols: ItemName | Pack | Batch+Loc | Expiry | MRP | Qty | Free | D% | Rate | GST% | Amount | Del
// "Free" is scheme quantity (10+1): not charged, but deducted from the same batch.
const COL = "grid-cols-[minmax(200px,1fr)_80px_104px_72px_80px_72px_56px_64px_90px_64px_104px_38px]";

const CONTROLLED_BADGE: Record<string, string> = {
  H:  "bg-amber-100 text-amber-700 border-amber-200",
  H1: "bg-orange-100 text-orange-700 border-orange-200",
  X:  "bg-red-100 text-red-600 border-red-200",
};

const TH = "text-[11px] font-bold text-slate-500 uppercase tracking-wider text-right px-2.5 select-none whitespace-nowrap";

// ─── Table header ─────────────────────────────────────────────────
export function CartTableHeader() {
  return (
    <div className={cn("grid items-center bg-slate-50 border-b border-slate-200", COL)}>
      <span className={cn(TH, "text-left px-3 py-2.5")}>Item</span>
      <span className={cn(TH, "text-left px-2.5 py-2.5")}>Pack</span>
      <span className={cn(TH, "py-2.5")}>Batch / Loc</span>
      <span className={cn(TH, "py-2.5")}>Expiry</span>
      <span className={cn(TH, "py-2.5")}>MRP</span>
      <span className={cn(TH, "py-2.5")}>Qty</span>
      <span className={cn(TH, "py-2.5")} title="Scheme quantity given free — not charged, but deducted from stock">Free</span>
      <span className={cn(TH, "py-2.5")}>Disc %</span>
      <span className={cn(TH, "py-2.5")}>Rate</span>
      <span className={cn(TH, "py-2.5")}>GST</span>
      <span className={cn(TH, "py-2.5")}>Amount</span>
      <span className={cn(TH, "py-2.5")} />
    </div>
  );
}

// ─── Skeleton row ─────────────────────────────────────────────────
function SkeletonRow({ idx }: { idx: number }) {
  return (
    <div className={cn("grid items-center border-b border-slate-100", COL, idx % 2 === 1 ? "bg-slate-50/40" : "bg-white")} style={{ height: "var(--row-height, 42px)" }}>
      <div className="px-3 flex items-center gap-2">
        <div className="skeleton h-3.5 w-36 rounded" />
      </div>
      {[80, 104, 72, 80, 72, 56, 64, 90, 64, 104].map((w, i) => (
        <div key={i} className="px-2.5 flex justify-end">
          <div className="skeleton h-3 rounded" style={{ width: w * 0.44 }} />
        </div>
      ))}
      <div />
    </div>
  );
}

// ─── Cart Row ─────────────────────────────────────────────────────
const CartRow = memo(function CartRow({
  item, idx, hasConflict, onKeyNav, onRemove, onQtyChange, onFreeQtyChange, onDiscountChange, onSwapBatch,
}: {
  item: CartItem; idx: number; hasConflict: boolean;
  onKeyNav:         (e: React.KeyboardEvent<HTMLInputElement>, idx: number, col: "qty" | "dis") => void;
  onRemove:         (id: string) => void;
  onQtyChange:      (id: string, qty: number) => void;
  onFreeQtyChange:  (id: string, freeQty: number) => void;
  onDiscountChange: (id: string, discount: number) => void;
  onSwapBatch:      (item: CartItem) => void;
}) {
  const now  = Date.now();
  const expiry = new Date(item.expiryDate).getTime();
  const isExpired      = expiry < now;
  const isExpiringSoon = !isExpired && expiry < now + 90 * 86400_000;

  const stockStatus: "ok" | "low" | "max" | "over" | null = (() => {
    if (item.availableStock == null) return null;
    // "over" survives the entry cap in useBillingStore: a draft parked before the
    // stock moved, or another till selling the same batch, can both leave a line
    // above what is now on the shelf.
    if (item.quantity > item.availableStock) return "over";
    // The line is sitting exactly on the cap — say so, otherwise a cashier who
    // typed 50 and got 3 has no explanation for the number that appeared.
    if (item.quantity === item.availableStock) return "max";
    if (item.quantity >= item.availableStock * 0.8) return "low";
    return "ok";
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
      className={cn(
        "grid items-center border-b border-slate-100/80 group",
        "transition-colors duration-75",
        hasConflict
          ? "bg-red-50/70 shadow-[inset_3px_0_0_0_#ef4444]"
          : "hover:bg-blue-50/35 hover:shadow-[inset_3px_0_0_0_#2563eb]",
        COL,
        !hasConflict && (idx % 2 === 1 ? "bg-slate-50/25" : "bg-white")
      )}
      style={{ minHeight: "var(--row-height, 42px)" }}
    >
      {/* Item Name */}
      <div className="px-3 py-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {hasConflict && <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />}
          <p className={cn(
            "text-[14px] font-semibold truncate leading-tight",
            hasConflict ? "text-red-700" : "text-slate-800"
          )}>
            {item.medicineName}
          </p>
          {item.schedule && CONTROLLED_BADGE[item.schedule.toUpperCase()] && (
            <span className={cn("flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none border", CONTROLLED_BADGE[item.schedule.toUpperCase()])}>
              Sch {item.schedule.toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {item.hsnCode && (
            <p className="text-[10px] text-slate-400 font-mono">HSN {item.hsnCode}</p>
          )}
          {stockStatus !== null && item.availableStock != null && (
            <p className={cn(
              "text-[10px] font-semibold",
              stockStatus === "over" ? "text-red-500" :
              stockStatus === "max"  ? "text-amber-600" :
              stockStatus === "low"  ? "text-amber-500" : "text-slate-400"
            )}>
              {stockStatus === "over"
                ? `⚠ Only ${item.availableStock} in stock`
                : stockStatus === "max"
                ? `⚠ Max — only ${item.availableStock} in stock`
                : stockStatus === "low"
                ? `${item.availableStock - item.quantity} left`
                : null}
            </p>
          )}
        </div>
      </div>

      {/* Pack */}
      <span className={cn("px-2.5 py-2 text-[13px] text-left truncate", item.packSize ? "text-slate-600 font-medium" : "text-slate-300")}>
        {item.packSize ?? "—"}
      </span>

      {/* Batch + Loc + stock — click opens batch picker */}
      <div className="px-2.5 py-2 min-w-0 text-right">
        <button
          onClick={() => onSwapBatch(item)}
          title="Change batch"
          className="text-[12px] font-mono font-semibold text-slate-700 hover:text-blue-600 transition-colors"
        >
          {item.batchNumber}
        </button>
        {item.location ? (
          <div className="flex items-center justify-end gap-0.5 mt-0.5">
            <MapPin className="w-2.5 h-2.5 text-blue-400 flex-shrink-0" />
            <p className="text-[10px] text-blue-500 font-semibold truncate">{item.location}</p>
          </div>
        ) : (
          <p className="text-[9px] text-slate-300 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            No location
          </p>
        )}
        {item.availableStock != null && (
          <p className={cn(
            "text-[10px] font-semibold mt-0.5",
            item.availableStock === 0 ? "text-red-500"   :
            item.availableStock <= 5  ? "text-red-500"   :
            item.availableStock <= 20 ? "text-amber-500" :
            "text-emerald-600"
          )}>
            {item.availableStock} in stock
          </p>
        )}
      </div>

      {/* Expiry */}
      <span className={cn(
        "px-2.5 py-2 text-[13px] text-right font-bold tabnum",
        isExpired      ? "text-red-600"   :
        isExpiringSoon ? "text-amber-600" : "text-slate-500"
      )}>
        {format(new Date(item.expiryDate), "MM/yy")}
        {isExpired && <span className="ml-0.5 text-[9px] bg-red-100 text-red-600 px-1 py-0.5 rounded font-bold">EXP</span>}
        {isExpiringSoon && !isExpired && <span className="ml-0.5 text-[9px] bg-amber-100 text-amber-600 px-1 py-0.5 rounded font-bold">SOON</span>}
      </span>

      {/* MRP */}
      <span className="px-2.5 py-2 text-[14px] text-slate-700 text-right font-medium tabnum">
        {item.mrp.toFixed(2)}
      </span>

      {/* Qty */}
      <div className="px-1.5 py-1.5">
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
            "w-full text-center text-[14px] font-bold tabnum",
            "border border-slate-200 rounded-md px-1 py-1.5",
            "focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-400",
            "bg-white hover:border-blue-300 transition-all duration-75"
          )}
        />
      </div>

      {/* Free (scheme qty) — zero shows as a muted placeholder rather than a hard
          "0", so a row with no scheme reads as empty at a glance. */}
      <div className="px-1.5 py-1.5">
        <input
          type="number"
          min={0}
          value={item.freeQty || ""}
          placeholder="0"
          title="Free / scheme quantity — not charged, deducted from stock"
          data-row={idx}
          data-col="free"
          onChange={(e) => onFreeQtyChange(item.inventoryId, Number(e.target.value))}
          onFocus={(e) => e.target.select()}
          className={cn(
            "w-full text-center text-[14px] tabnum",
            item.freeQty > 0 ? "font-bold text-emerald-700" : "text-slate-400",
            "border border-slate-200 rounded-md px-1 py-1.5",
            "focus:outline-none focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-400",
            "bg-white hover:border-emerald-300 transition-all duration-75"
          )}
        />
      </div>

      {/* D% */}
      <div className="px-1.5 py-1.5">
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
            "w-full text-center text-[13px] tabnum",
            "border border-slate-200 rounded-md px-1 py-1.5",
            "focus:outline-none focus:ring-2 focus:ring-rose-500/25 focus:border-rose-400",
            "bg-white hover:border-rose-300 transition-all duration-75",
            item.discount > 0 ? "text-rose-600 font-bold" : "text-slate-500"
          )}
        />
      </div>

      {/* Rate */}
      <span className="px-2.5 py-2 text-[13px] text-slate-600 text-right tabnum">
        {item.rate.toFixed(2)}
      </span>

      {/* GST% */}
      <span className="px-2.5 py-2 text-[12px] text-slate-500 text-right tabnum">
        {item.gstRate}%
      </span>

      {/* Amount */}
      <span
        key={item.amount}
        className="px-2.5 py-2 text-[15px] font-black text-slate-900 text-right tabnum block animate-amount-pop"
      >
        {item.amount.toFixed(2)}
      </span>

      {/* Delete */}
      <div className="flex justify-center">
        <button
          onClick={() => onRemove(item.inventoryId)}
          tabIndex={-1}
          className="row-delete-btn opacity-0 group-hover:opacity-100 w-6 h-6 rounded-md bg-red-50 hover:bg-red-500 text-red-400 hover:text-white flex items-center justify-center transition-all duration-100 hover:scale-110 active:scale-90 will-change-transform"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
});

// ─── CartTableRows ────────────────────────────────────────────────
export function CartTableRows({
  showSkeleton = false,
  conflictInventoryIds = new Set<string>(),
}: {
  showSkeleton?: boolean;
  conflictInventoryIds?: Set<string>;
}) {
  const items          = useBillingStore((s) => s.items);
  const removeItem     = useBillingStore((s) => s.removeItem);
  const updateQty      = useBillingStore((s) => s.updateQty);
  const updateFreeQty  = useBillingStore((s) => s.updateFreeQty);
  const updateDiscount = useBillingStore((s) => s.updateDiscount);
  const replaceItem    = useBillingStore((s) => s.replaceItem);

  const [swapTarget,  setSwapTarget]  = useState<CartItem | null>(null);
  const [swapBatches, setSwapBatches] = useState<InventoryBatch[]>([]);

  const handleSwapBatch = useCallback(async (item: CartItem) => {
    setSwapTarget(item);
    try {
      const res = await api.get<{ data: { items: InventoryBatch[] } }>("/inventory", {
        params: { search: item.medicineName, inStock: false, limit: 30 },
      });
      const batches = (res.data?.data?.items ?? [])
        .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
      setSwapBatches(batches);
    } catch {
      setSwapTarget(null);
    }
  }, []);

  const handleBatchSelect = useCallback((batch: InventoryBatch) => {
    if (!swapTarget) return;
    replaceItem(swapTarget.inventoryId, {
      inventoryId:    batch.id,
      medicineName:   batch.medicine.name,
      hsnCode:        batch.medicine.hsnCode,
      schedule:       swapTarget.schedule,
      packSize:       swapTarget.packSize,
      location:       getLocationLabel(batch) ?? undefined,
      batchNumber:    batch.batchNumber,
      expiryDate:     batch.expiryDate,
      mrp:            batch.mrp,
      quantity:       swapTarget.quantity,
      discount:       swapTarget.discount,
      gstRate:        batch.medicine.gstRate,
      availableStock: batch.quantity - (batch.reservedQuantity ?? 0),
    });
    setSwapTarget(null);
    setSwapBatches([]);
  }, [swapTarget, replaceItem]);

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
        <div className="min-w-max">{[0, 1, 2].map(i => <SkeletonRow key={i} idx={i} />)}</div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto flex flex-col">
        <EmptyBillState />
        <div className="px-4 pb-6 w-full max-w-sm mx-auto">
          <RecentItemsCard />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-y-auto overflow-x-auto flex-1">
        <div className="min-w-max">
          <AnimatePresence initial={false}>
            {items.map((item, idx) => (
              <CartRow
                key={item.inventoryId}
                item={item}
                idx={idx}
                hasConflict={conflictInventoryIds.has(item.inventoryId)}
                onKeyNav={handleKeyNav}
                onRemove={removeItem}
                onQtyChange={updateQty}
                onFreeQtyChange={updateFreeQty}
                onDiscountChange={updateDiscount}
                onSwapBatch={handleSwapBatch}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {swapTarget && swapBatches.length > 0 && (
          <BatchPickerDialog
            medicineName={swapTarget.medicineName}
            batches={swapBatches}
            onSelect={handleBatchSelect}
            onClose={() => { setSwapTarget(null); setSwapBatches([]); }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
