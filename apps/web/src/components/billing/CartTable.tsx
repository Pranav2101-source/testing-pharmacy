"use client";

import { useCallback, memo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { X, AlertTriangle, MapPin } from "lucide-react";
import { useBillingStore, type CartItem, type NewCartItem, lineIssue, looseStripsOpened } from "./useBillingStore";
import { EmptyBillState } from "./EmptyBillState";
import { RecentItemsCard } from "./RecentItemsCard";
import { BatchPickerDialog, type InventoryBatch, expiryStatus, getLocationLabel } from "./BatchPickerDialog";
import { baseUnitShort, saleUnitModel, titleCaseUnit, pluraliseUnit } from "@pharmacy/utils";
import { packDisplayLabel, parseMeasuredPackSize } from "@/lib/packSize";
import { api, getErrorMessage } from "@/lib/api-client";
import { getStoredUser } from "@/lib/auth";
import { queryKeys } from "@/lib/queryKeys";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

// Column grid — 12 cols: ItemName | Pack | Batch+Loc | Expiry | MRP | Qty | Free | D% | Rate | GST% | Amount | Del
// Pack is wide enough (120px) for the pack-size label AND a "LOOSE OK" badge beside it —
// at 80px the badge crushed "15/strip" down to a stray "1" (see CartRowPackColumn tests).
// "Free" is scheme quantity (10+1): not charged, but deducted from the same batch.
const COL = "grid-cols-[minmax(180px,1fr)_120px_104px_72px_80px_128px_56px_64px_90px_50px_104px_38px]";

const CONTROLLED_BADGE: Record<string, string> = {
  H:  "bg-amber-100 text-amber-700 border-amber-200",
  H1: "bg-orange-100 text-orange-700 border-orange-200",
  X:  "bg-red-100 text-red-600 border-red-200",
};

/** Pieces a batch can give a loose sale: unreserved sealed packs opened up, plus the loose remainder. */
export function loosePiecesOf(b: InventoryBatch, upp: number): number {
  const packs = Math.max(0, b.quantity - (b.reservedQuantity ?? 0));
  return packs * upp + (b.looseUnits ?? 0);
}

/**
 * What a cart line's unit and quantity should become after swapping to a different
 * batch. Pure, so the conversion is testable without touching the DOM or the store —
 * same pattern as {@link planLooseSplit} below.
 *
 * A LOOSE (piece-count) line landing on a batch that can't sell loose would otherwise
 * carry its piece count straight into what becomes a pack-count field — "8 tablets"
 * silently turning into "8 whole packs". Converts to the equivalent pack count instead
 * (rounded up, so the patient never gets less than intended); the caller is expected to
 * surface `forcedToPack` to the cashier rather than let it pass unexplained.
 */
export function nextLineAfterBatchSwap(
  current: { saleUnit?: string; quantity: number; unitsPerPack?: number },
  nextAllowLooseSale: boolean,
  nextUnitsPerPack: number | undefined,
): { saleUnit: "PACK" | "LOOSE"; quantity: number; forcedToPack: boolean } {
  const wasLoose = current.saleUnit === "LOOSE";
  const keepLoose = wasLoose && nextAllowLooseSale && (nextUnitsPerPack ?? 0) > 1;
  const forcedToPack = wasLoose && !keepLoose;
  const quantity = forcedToPack
    ? Math.max(1, Math.ceil(current.quantity / (current.unitsPerPack ?? 1)))
    : current.quantity;
  return { saleUnit: keepLoose ? "LOOSE" : "PACK", quantity, forcedToPack };
}

/**
 * Plan the extra cart lines for a loose quantity that overflowed its batch. Pure —
 * given the fetched batches and what the cart already holds, it decides which
 * batches to spill onto, FEFO first, without touching any store. Returns the lines
 * to add and how many pieces still can't be filled.
 */
export function planLooseSplit(
  template: CartItem,
  wantedPieces: number,
  cartItems: { inventoryId: string; medicineName: string; saleUnit?: string; quantity: number }[],
  fetchedBatches: InventoryBatch[],
  now = Date.now(),
  /** When the batches already arrive in the dispensing engine's strategy order (GET /dispensing/batches), keep it rather than re-sorting FEFO. */
  batchesAreStrategyOrdered = false,
): { lines: NewCartItem[]; shortfall: number } {
  const upp = template.unitsPerPack ?? 1;
  if (upp <= 1 || !Number.isInteger(wantedPieces) || wantedPieces < 1) return { lines: [], shortfall: 0 };

  const already = cartItems
    .filter((i) => i.medicineName === template.medicineName && i.saleUnit === "LOOSE")
    .reduce((n, i) => n + i.quantity, 0);
  let remaining = wantedPieces - already;
  if (remaining < 1) return { lines: [], shortfall: 0 };

  const inCartIds = new Set(cartItems.map((i) => i.inventoryId));
  const filtered = fetchedBatches
    .filter((b) => b.medicine.name === template.medicineName   // /inventory search is fuzzy — pin the exact medicine
      && !inCartIds.has(b.id)
      && new Date(b.expiryDate).getTime() > now
      && (b.medicine.allowLooseSale ?? false)
      && loosePiecesOf(b, b.medicine.unitsPerPack ?? upp) > 0);
  const candidates = batchesAreStrategyOrdered
    ? filtered  // already ordered by the dispensing engine's strategy
    : [...filtered].sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());

  const lines: NewCartItem[] = [];
  for (const b of candidates) {
    if (remaining < 1) break;
    const take = Math.min(remaining, loosePiecesOf(b, b.medicine.unitsPerPack ?? upp));
    if (take < 1) continue;
    lines.push(looseLineFromBatch(b, template, take));
    remaining -= take;
  }
  return { lines, shortfall: Math.max(0, remaining) };
}

type LooseCartRow = { inventoryId: string; medicineName: string; saleUnit?: string; quantity: number };

/**
 * Fetch the medicine's other batches, plan the spill, add the lines, tell the
 * cashier. Dependencies are injected so this is testable without a DOM — the React
 * hook below is a thin wrapper that supplies `api`, the store's `addItem` and the
 * toast.
 */
export async function runLooseOverflow(
  item: CartItem,
  typed: number,
  cartItems: LooseCartRow[],
  deps: {
    fetchBatches: (medicineName: string) => Promise<InventoryBatch[]>;
    addLine: (line: NewCartItem) => void;
    notify: { info: (m: string) => void; warning: (m: string) => void; error: (m: string) => void };
    /** Set when fetchBatches returns the dispensing engine's strategy-ordered list. */
    batchesAreStrategyOrdered?: boolean;
  },
): Promise<void> {
  if (item.saleUnit !== "LOOSE" || (item.unitsPerPack ?? 1) <= 1) return;
  const unit = baseUnitShort(item.baseUnit);

  let fetched: InventoryBatch[];
  try {
    fetched = await deps.fetchBatches(item.medicineName);
  } catch {
    deps.notify.error(`Couldn't check other batches of ${item.medicineName}.`);
    return;
  }

  const { lines, shortfall } = planLooseSplit(
    item, typed, cartItems, fetched, Date.now(), deps.batchesAreStrategyOrdered ?? false);
  if (lines.length === 0) {
    if (shortfall > 0) {
      deps.notify.warning(`No other batch of ${item.medicineName} has loose stock — ${shortfall} ${unit} short.`);
    }
    return;
  }

  const summary = lines.map((l) => `${l.quantity} ${unit} from ${l.batchNumber}`).join(", ");
  lines.forEach(deps.addLine);
  if (shortfall > 0) {
    deps.notify.warning(`Split across batches; still ${shortfall} ${unit} short: ${item.quantity} ${unit} here, ${summary}.`);
  } else {
    deps.notify.info(`Split across batches: ${item.quantity} ${unit} on this line, ${summary}.`);
  }
}

/** A loose cart line drawn from one specific batch — the shape addItem() wants, money left to recompute(). */
function looseLineFromBatch(b: InventoryBatch, template: CartItem, qty: number): NewCartItem {
  return {
    inventoryId:    b.id,
    medicineName:   b.medicine.name,
    hsnCode:        b.medicine.hsnCode,
    schedule:       template.schedule,
    packSize:       template.packSize,
    location:       getLocationLabel(b) ?? undefined,
    batchNumber:    b.batchNumber,
    expiryDate:     b.expiryDate,
    mrp:            b.mrp,
    quantity:       qty,
    discount:       template.discount,
    gstRate:        b.medicine.gstRate,
    availableStock: Math.max(0, b.quantity - (b.reservedQuantity ?? 0)),
    saleUnit:       "LOOSE",
    unitsPerPack:   b.medicine.unitsPerPack ?? template.unitsPerPack ?? undefined,
    baseUnit:       b.medicine.baseUnit ?? template.baseUnit ?? undefined,
    allowLooseSale: b.medicine.allowLooseSale ?? true,
    looseUnits:     b.looseUnits ?? 0,
  };
}

const TH ="text-[11px] font-bold text-slate-500 uppercase tracking-wider text-right px-2.5 select-none whitespace-nowrap";

// ─── Numeric cell ─────────────────────────────────────────────────
/**
 * A number cell that can be empty while you are typing in it.
 *
 * The cells here used to be `<input type="number" value={item.quantity}>` committing
 * `Number(e.target.value)` straight to the store. Backspacing to clear one produced
 * `Number("") === 0`, the store's floor of 1 turned that into 1, and React repainted
 * the 1 the cashier had just deleted — so replacing "1" with "25" left "125" in the
 * box and ₹3,750 on a ₹750 bill. The field has to be allowed to be empty *for as long
 * as a hand is in it*, which a value bound straight to a clamped number can never be.
 *
 * So: `draft` holds the raw text while focused and the store holds the truth. Each
 * keystroke that parses is still committed immediately, so the running total is never
 * stale; blur drops the draft and the cell snaps to whatever the store settled on.
 *
 * `type="text"` with `inputMode="numeric"`, not `type="number"`, for two reasons: a
 * number input hands back "" for anything it considers half-typed ("1e", "1..2"),
 * which is indistinguishable from a cleared field; and its up/down arrows never
 * worked here anyway, because ArrowUp/ArrowDown are bound to row navigation.
 */
export function NumericCell({
  value, onCommit, onSettle, decimals = false, blankWhenZero = false, emptyCommitsZero = false,
  placeholder, title, className, dataRow, dataCol, onKeyDown,
}: {
  value:        number;
  onCommit:     (n: number) => void;
  /** Fired on blur with the last number typed, so the caller can report a clamp. */
  onSettle?:    (typed: number) => void;
  decimals?:    boolean;
  /** Show an empty box instead of "0", so a row with no scheme reads as blank. */
  blankWhenZero?: boolean;
  /**
   * Leaving the field empty on blur commits 0 instead of reverting to the last
   * value. Right for a column where 0 is itself a meaningful, common value (no
   * discount, no free qty) — wrong for Qty, where 0 doesn't mean anything (an
   * empty line should be removed, not silently zeroed) and clearing-then-blurring
   * is how a cashier backs out of a keystroke while keeping the line.
   */
  emptyCommitsZero?: boolean;
  placeholder?: string;
  title?:       string;
  className?:   string;
  dataRow:      number;
  dataCol:      string;
  onKeyDown?:   (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function handleChange(raw: string) {
    // Keep only what this cell accepts. Quantities are whole numbers; a discount may
    // carry one decimal point, and every dot after the first is dropped rather than
    // making the value unparseable.
    let cleaned = decimals ? raw.replace(/[^\d.]/g, "") : raw.replace(/\D/g, "");
    if (decimals) {
      const firstDot = cleaned.indexOf(".");
      if (firstDot !== -1) {
        cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
      }
    }
    setDraft(cleaned);

    // An empty (or bare ".") cell commits nothing: the last good number stands until
    // a new one is typed. Committing 0 here is what caused the snap-back.
    const parsed = Number(cleaned);
    if (cleaned === "" || cleaned === "." || Number.isNaN(parsed)) return;
    onCommit(parsed);
  }

  function handleBlur() {
    const typed = draft;
    setDraft(null); // fall back to the store's value, clamped and settled
    if (emptyCommitsZero && (typed === "" || typed === ".")) {
      onCommit(0);
      onSettle?.(0);
      return;
    }
    if (typed && typed !== "." && !Number.isNaN(Number(typed))) onSettle?.(Number(typed));
  }

  return (
    <input
      type="text"
      inputMode={decimals ? "decimal" : "numeric"}
      value={draft ?? (blankWhenZero && value === 0 ? "" : String(value))}
      placeholder={placeholder}
      title={title}
      data-row={dataRow}
      data-col={dataCol}
      onChange={(e) => handleChange(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={handleBlur}
      onKeyDown={onKeyDown}
      className={className}
    />
  );
}

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
      {[80, 104, 72, 80, 128, 56, 64, 90, 50, 104].map((w, i) => (
        <div key={i} className="px-2.5 flex justify-end">
          <div className="skeleton h-3 rounded" style={{ width: w * 0.44 }} />
        </div>
      ))}
      <div />
    </div>
  );
}

// ─── Cart Row ─────────────────────────────────────────────────────
// Exported (only) so tests can render one row in isolation — every dependency is an
// explicit prop, no store/query/toast context required — and drive its "L" row-wide
// keyboard shortcut without standing up the whole cart.
export const CartRow = memo(function CartRow({
  item, idx, hasConflict, onKeyNav, onRemove, onQtyChange, onFreeQtyChange, onDiscountChange, onSwapBatch,
  onQtySettled, onFreeSettled, onSaleUnitChange, onFixIssue, onClassifyMeasured,
}: {
  item: CartItem; idx: number; hasConflict: boolean;
  onKeyNav:         (e: React.KeyboardEvent<HTMLInputElement>, idx: number, col: "qty" | "dis") => void;
  onRemove:         (id: string) => void;
  onQtyChange:      (id: string, qty: number) => void;
  onFreeQtyChange:  (id: string, freeQty: number) => void;
  onDiscountChange: (id: string, discount: number) => void;
  onSwapBatch:      (item: CartItem) => void;
  onSaleUnitChange: (id: string, unit: "PACK" | "LOOSE") => void;
  onFixIssue:       (id: string, patch: Partial<CartItem>) => void;
  /** Called when a quantity cell is left, with the number that was typed into it. */
  onQtySettled:     (item: CartItem, typed: number) => void;
  onFreeSettled:    (item: CartItem, typed: number) => void;
  /** Record how many base units (mL/g) are in one sealed pack of an as-yet-unclassified liquid/cream. */
  onClassifyMeasured?: (item: CartItem, unitsPerPack: number) => void;
}) {
  const now  = Date.now();
  const expiry = new Date(item.expiryDate).getTime();
  const isExpired      = expiry < now;
  const isExpiringSoon = !isExpired && expiry < now + 90 * 86400_000;

  const isLoose   = item.saleUnit === "LOOSE";
  const upp       = item.unitsPerPack ?? 1;
  const canLoose  = !!item.allowLooseSale && upp > 1;
  const packLabel = packDisplayLabel(item.packSize, item.unitsPerPack, item.baseUnit);
  const issue     = lineIssue(item);
  const looseOpensStrips = looseStripsOpened(item);
  // The sale-unit vocabulary for THIS line — "bottle"/"mL" for a syrup, "tube"/"g"
  // for a cream, "strip"/"tab" for a tablet — so nothing below says "strip" for a
  // bottle. Derived from the base unit (no medicine `unit`/`form` on a cart line;
  // strip/bottle/tube covers every form this pharmacy actually stocks loose).
  const sum        = saleUnitModel({
    baseUnit: item.baseUnit, unitsPerPack: item.unitsPerPack,
    allowLooseSale: item.allowLooseSale, schedule: item.schedule,
  });
  const packWord   = sum.packUnitLabel;                       // "strip" | "bottle" | "tube" | "unit"
  const looseWord  = sum.looseUnitShort;                      // "tab" | "cap" | "mL" | "g" | "u"
  // Everything on a loose line — quantity, the cap, the stock hint — is in pieces.
  const effAvailable = item.availableStock == null
    ? undefined
    : isLoose ? item.availableStock * upp + (item.looseUnits ?? 0) : item.availableStock;

  const stockStatus: "ok" | "low" | "max" | "over" | null = (() => {
    if (effAvailable == null) return null;
    // "over" survives the entry cap in useBillingStore: a draft parked before the
    // stock moved, or another till selling the same batch, can both leave a line
    // above what is now on the shelf.
    if (item.quantity > effAvailable) return "over";
    // The line is sitting exactly on the cap — say so, otherwise a cashier who
    // typed 50 and got 3 has no explanation for the number that appeared.
    if (item.quantity === effAvailable) return "max";
    if (item.quantity >= effAvailable * 0.8) return "low";
    return "ok";
  })();

  /**
   * "L" toggles Strip/Loose for this row from anywhere inside it — Qty, Free, Disc%,
   * not just Qty. A single delegated handler on the row root (rather than repeating
   * the check in each cell's own onKeyDown) is what makes that automatic: a keydown
   * on any input inside this row bubbles up here, and none of Qty/Free/Disc's own
   * handlers call stopPropagation, so this always sees it. Purely synchronous —
   * setSaleUnit is an in-memory store update, no network call.
   */
  function handleRowKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (canLoose && (e.key === "l" || e.key === "L")) {
      e.preventDefault();
      onSaleUnitChange(item.inventoryId, isLoose ? "PACK" : "LOOSE");
    }
  }

  return (
    <>
    <motion.div
      data-inventory-id={item.inventoryId}
      onKeyDown={handleRowKeyDown}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
      className={cn(
        "grid items-center group",
        "transition-colors duration-75",
        issue     ? "bg-amber-50/70 shadow-[inset_3px_0_0_0_#f59e0b] border-b border-amber-100" :
        hasConflict
          ? "bg-red-50/70 shadow-[inset_3px_0_0_0_#ef4444] border-b border-slate-100/80"
          : "hover:bg-blue-50/35 hover:shadow-[inset_3px_0_0_0_#2563eb] border-b border-slate-100/80",
        COL,
        !hasConflict && !issue && (idx % 2 === 1 ? "bg-slate-50/25" : "bg-white")
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
          {stockStatus !== null && effAvailable != null && (
            <p className={cn(
              "text-[10px] font-semibold",
              stockStatus === "over" ? "text-red-500" :
              stockStatus === "max"  ? "text-amber-600" :
              stockStatus === "low"  ? "text-amber-500" : "text-slate-400"
            )}>
              {stockStatus === "over"
                ? `⚠ Only ${effAvailable} ${isLoose ? baseUnitShort(item.baseUnit) : ""} in stock`
                : stockStatus === "max"
                ? `⚠ Max — only ${effAvailable} ${isLoose ? baseUnitShort(item.baseUnit) : ""} in stock`
                : stockStatus === "low"
                ? `${effAvailable - item.quantity} left`
                : null}
            </p>
          )}
        </div>
      </div>

      {/* Pack — the medicine's real pack size: the catalogue's free-text packSize when it's
          descriptive ("100ml", "1x15"), else a base-unit-aware computed label ("15/strip"
          for a tablet, "100ml" for a syrup — never "/strip" for a liquid), see
          packDisplayLabel. "LOOSE OK" rides beside it as a SECONDARY badge and never
          replaces it. The Strip/Tab toggle itself lives on the Qty cell. */}
      <span data-col="pack" className={cn("px-2.5 py-2 text-[13px] text-left flex items-center gap-1 min-w-0",
        packLabel !== "—" ? "text-slate-600 font-medium" : "text-slate-300")}>
        <span data-pack-label className="min-w-0 truncate">{packLabel}</span>
        {canLoose && (
          <span className="flex-shrink-0 text-[8px] font-bold px-1 py-px rounded bg-amber-100 text-amber-700 leading-none">LOOSE OK</span>
        )}
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
          <p className="text-[9px] text-slate-300 mt-0.5">
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

      {/* MRP — for a loose line, the per-piece price under the printed pack MRP */}
      <span className="px-2.5 py-2 text-right font-medium tabnum leading-tight">
        <span className="text-[14px] text-slate-700 block">{item.mrp.toFixed(2)}</span>
        {isLoose && (
          <span className="text-[10px] text-amber-600 font-semibold block">
            {(item.mrp / upp).toFixed(2)}/{baseUnitShort(item.baseUnit)}
          </span>
        )}
      </span>

      {/* Qty — for a loose-capable line, the unit sits right here so the cashier
          just types the number the doctor wrote and picks tab / strip. Press "L"
          anywhere in this row (see handleRowKeyDown) to flip the unit without the
          mouse — not just from this field. */}
      <div className="px-1.5 py-1.5">
        <div className="flex items-stretch gap-1">
          <NumericCell
            value={item.quantity}
            onCommit={(n) => onQtyChange(item.inventoryId, n)}
            onSettle={(typed) => onQtySettled(item, typed)}
            dataRow={idx}
            dataCol="qty"
            title={canLoose
              ? `Press L to switch between ${packWord} and ${looseWord}`
              : `Quantity in ${pluraliseUnit(packWord, item.quantity)}`}
            onKeyDown={(e) => onKeyNav(e, idx, "qty")}
            className={cn(
              "flex-1 min-w-0 text-center text-[16px] font-bold tabnum",
              "border rounded-md px-2 py-2",
              isLoose ? "border-amber-300 bg-amber-50/40" : "border-slate-200 bg-white",
              "focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-400",
              "hover:border-blue-300 transition-all duration-75"
            )}
          />
          {/* Strip / loose — a segmented toggle, not a native <select>, so it reads as one
              deliberate control instead of a dropdown bolted onto a number box. Same two
              states, same "L" shortcut above; clicking either half fires the same handler
              and refocuses Qty so the cashier can retype the count in the new unit. */}
          {canLoose && (
            <div
              role="group"
              aria-label={`Sell ${item.medicineName} by ${packWord} or ${looseWord}`}
              className="flex flex-shrink-0 rounded-md border border-slate-200 overflow-hidden"
            >
              {([
                { unit: "PACK" as const, label: titleCaseUnit(packWord) },
                { unit: "LOOSE" as const, label: titleCaseUnit(looseWord) },
              ]).map(({ unit, label }, i) => {
                const active = (unit === "LOOSE") === isLoose;
                return (
                  <button
                    key={unit}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      onSaleUnitChange(item.inventoryId, unit);
                      requestAnimationFrame(() => {
                        const el = document.querySelector<HTMLInputElement>(`[data-row="${idx}"][data-col="qty"]`);
                        el?.focus(); el?.select();
                      });
                    }}
                    className={cn(
                      "px-1.5 py-1 text-[10px] font-bold leading-none whitespace-nowrap transition-colors",
                      i === 1 && "border-l border-slate-200",
                      active
                        ? unit === "LOOSE" ? "bg-amber-500 text-white" : "bg-slate-700 text-white"
                        : "bg-white text-slate-400 hover:bg-slate-50",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {/* Animated height (not a plain conditional) so flipping the Strip/Tab toggle
            doesn't snap every row below it down instantly — this is the one spot in
            an otherwise-animated cart that used to jump. */}
        <AnimatePresence initial={false}>
          {looseOpensStrips > 0 && (
            <motion.p
              key="opens"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="text-[9px] text-amber-600 font-semibold mt-0.5 text-center leading-none overflow-hidden"
            >
              opens {looseOpensStrips} sealed {pluraliseUnit(packWord, looseOpensStrips)}
            </motion.p>
          )}
          {/* Whole-unit line whose unit isn't the obvious "strip" — spell out that the
              number is bottles / tubes / vials, so a syrup's "2" never reads as 2 mL. */}
          {!canLoose && !isLoose && packWord !== "strip" && packWord !== "unit" && (
            <motion.p
              key="wholeunit"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="text-[9px] text-slate-400 font-semibold mt-0.5 text-center leading-none overflow-hidden"
            >
              {pluraliseUnit(packWord, item.quantity)}
            </motion.p>
          )}
          {isLoose && (item.looseUnits ?? 0) > 0 && looseOpensStrips === 0 && (
            <motion.p
              key="open"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="text-[9px] text-emerald-600 font-semibold mt-0.5 text-center leading-none overflow-hidden"
            >
              from {item.looseUnits} already open
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Free (scheme qty) — zero shows as a muted placeholder rather than a hard
          "0", so a row with no scheme reads as empty at a glance. On a loose line
          this counts pieces, not strips (see clampLine in useBillingStore), so it
          gets the same amber tint + unit label as Qty — otherwise "2 free" reads as
          2 strips when it's actually 2 tablets. */}
      <div className="px-1.5 py-1.5">
        <NumericCell
          value={item.freeQty}
          onCommit={(n) => onFreeQtyChange(item.inventoryId, n)}
          onSettle={(typed) => onFreeSettled(item, typed)}
          blankWhenZero
          emptyCommitsZero
          placeholder="0"
          title={isLoose
            ? `Free / scheme quantity, in ${baseUnitShort(item.baseUnit)} — not charged, deducted from stock`
            : "Free / scheme quantity — not charged, deducted from stock"}
          dataRow={idx}
          dataCol="free"
          className={cn(
            "w-full text-center text-[14px] tabnum",
            item.freeQty > 0 ? "font-bold text-emerald-700" : "text-slate-400",
            "border rounded-md px-1 py-1.5",
            isLoose ? "border-amber-300 bg-amber-50/40" : "border-slate-200 bg-white",
            "focus:outline-none focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-400",
            "hover:border-emerald-300 transition-all duration-75"
          )}
        />
        {isLoose && item.freeQty > 0 && (
          <p className="text-[9px] text-amber-600 font-semibold mt-0.5 text-center leading-none">
            {looseWord}, not {pluraliseUnit(packWord, 2)}
          </p>
        )}
      </div>

      {/* D% — decimals allowed (half-percent schemes are common) */}
      <div className="px-1.5 py-1.5">
        <NumericCell
          value={item.discount}
          onCommit={(n) => onDiscountChange(item.inventoryId, n)}
          decimals
          emptyCommitsZero
          dataRow={idx}
          dataCol="dis"
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

      {/* Rate — per piece for a loose line */}
      <span className="px-2.5 py-2 text-[13px] text-slate-600 text-right tabnum">
        {item.rate.toFixed(2)}{isLoose && <span className="text-[10px] text-slate-400">/{baseUnitShort(item.baseUnit)}</span>}
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

      {/* Delete — always visible/focusable, not hover-only: a hover-revealed action is
          unreachable by keyboard (tabIndex=-1 used to lock it out entirely) and often
          unreachable by touch on a POS tablet, which has no hover state to reveal it. */}
      <div className="flex justify-center">
        <button
          onClick={() => onRemove(item.inventoryId)}
          aria-label={`Remove ${item.medicineName} from bill`}
          title="Remove from bill"
          className="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-500 text-red-400 hover:text-white flex items-center justify-center transition-all duration-100 hover:scale-110 active:scale-90 will-change-transform outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>

    {/* Line issue — the server would reject this at save; fix it here in one click.
        WHOLE_PACK_LOOSE also offers a deliberate "cut it anyway" past the guard. */}
    {issue && (
      <div className="flex items-center gap-2 bg-amber-50/70 border-b border-amber-200 px-4 py-1.5">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
        <span className="text-[12px] text-amber-800 flex-1">{issue.message}</span>
        {issue.override && (
          <button
            type="button"
            onClick={() => onFixIssue(item.inventoryId, issue.override!.patch)}
            className="text-[11px] font-semibold px-2 py-1 rounded-md border border-amber-300 text-amber-700 hover:bg-amber-100 transition-colors flex-shrink-0"
          >
            {issue.override.label}
          </button>
        )}
        <button
          type="button"
          onClick={() => onFixIssue(item.inventoryId, issue.fix)}
          className="text-[11px] font-bold px-2 py-1 rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors flex-shrink-0"
        >
          {issue.fixLabel}
        </button>
      </div>
    )}

    {/* Unclassified liquid / cream — billing treats the Qty as whole {bottles/tubes}
        (the only safe reading with no mL-per-bottle on record). Offer to record that
        size once, so a future prescription for "150 mL" resolves to 2 bottles instead
        of falling back to a plain count. Not an error — the sale is fine as-is. */}
    {!issue && sum.measured && !sum.classified && item.medicineId && onClassifyMeasured && (
      <MeasuredClassifyRow
        packWord={packWord}
        looseWord={looseWord}
        packSizeText={item.packSize}
        onSet={(n) => onClassifyMeasured(item, n)}
      />
    )}
    </>
  );
});

/** One-line inline prompt: "How many mL in one bottle? [__] Set" — see its only call site above. */
function MeasuredClassifyRow({
  packWord, looseWord, packSizeText, onSet,
}: {
  packWord: string;
  looseWord: string;
  /** Free-text pack size — a volume parsed out of it ("100ml" → 100) pre-fills the box, still eyeballed, never auto-saved. */
  packSizeText?: string;
  onSet: (unitsPerPack: number) => void;
}) {
  const [value, setValue] = useState(() => {
    const parsed = parseMeasuredPackSize(packSizeText);
    return parsed ? String(parsed) : "";
  });
  const [saving, setSaving] = useState(false);
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 2 && n <= 100000;

  return (
    <form
      className="flex items-center gap-2 bg-blue-50/60 border-b border-blue-100 px-4 py-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || saving) return;
        setSaving(true);
        onSet(n);
      }}
    >
      <MapPin className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 rotate-0" aria-hidden />
      <span className="text-[12px] text-blue-800 flex-1">
        How many {looseWord} in one sealed {packWord}? Set it once so prescriptions bill the right number of {pluraliseUnit(packWord, 2)}.
      </span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
        placeholder={looseWord}
        aria-label={`${looseWord} per ${packWord}`}
        className="w-16 text-center text-[12px] border border-blue-200 rounded-md px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400/30 flex-shrink-0"
      />
      <button
        type="submit"
        disabled={!valid || saving}
        className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-40 flex-shrink-0"
      >
        Set
      </button>
    </form>
  );
}

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
  const setSaleUnit    = useBillingStore((s) => s.setSaleUnit);
  const patchLine      = useBillingStore((s) => s.patchLine);
  const replaceItem    = useBillingStore((s) => s.replaceItem);

  const [swapTarget,  setSwapTarget]  = useState<CartItem | null>(null);
  const [swapBatches, setSwapBatches] = useState<InventoryBatch[]>([]);
  const toast = useToast();
  const queryClient = useQueryClient();
  // Recording a pharmacy pack size writes an override — an OWNER/MANAGER action
  // (see MedicineController#setLooseSettings). A cashier gets the safe whole-pack
  // fallback with no dead-end button.
  const canClassify = ["OWNER", "MANAGER"].includes(getStoredUser()?.role ?? "");

  /**
   * Say so when a typed quantity was not the quantity kept.
   *
   * The cap itself is right — the sale would be rejected at save otherwise — but it
   * used to be applied in silence: type 25 against 3 in stock and the cell simply
   * read 3, with nothing to distinguish that from a mistyped key. A cashier reading
   * back a bill has no way to notice a number they never entered.
   *
   * Read from the store rather than the `item` prop: the commit happened on the
   * keystroke before this blur, so the prop can be one render behind.
   */
  const reportClamp = useCallback((item: CartItem, typed: number, field: "quantity" | "freeQty") => {
    const settled = useBillingStore.getState().items.find(i => i.inventoryId === item.inventoryId)?.[field];
    if (settled == null || settled === typed) return;

    // Most specific reason first. The stock cap is checked last because it also
    // matches by coincidence — typing 0 against a single unit in stock settles on 1,
    // which equals availableStock, and "only 1 in stock" is not why it changed.
    if (field === "quantity" && typed < 1) {
      toast.warning(`${item.medicineName}: quantity cannot be below 1.`);
    } else if (!Number.isInteger(typed)) {
      toast.warning(`${item.medicineName}: quantity must be a whole number — set to ${settled}.`);
    } else if (field === "quantity" && item.availableStock != null && settled === item.availableStock) {
      toast.warning(`Only ${settled} of ${item.medicineName} in stock — quantity set to ${settled}.`);
    } else if (field === "freeQty" && settled < typed) {
      toast.warning(`${item.medicineName}: not enough stock for ${typed} free — set to ${settled}.`);
    }
  }, [toast]);

  const addItem = useBillingStore((s) => s.addItem);

  /**
   * A loose line the cashier sized past what its batch can cut — spill the rest onto
   * the next FEFO batches of the same medicine, as visible extra lines. Draws down
   * near-expiry remainders first, keeps every line single-batch (so the server stays
   * a fortress), and shows the split so nothing is silent. See {@link runLooseOverflow}.
   */
  const handleLooseOverflow = useCallback((item: CartItem, typed: number) =>
    runLooseOverflow(item, typed, useBillingStore.getState().items, {
      // Spill onto the SAME strategy-ordered batch list the dispensing engine
      // would use (GET /dispensing/batches — already ACTIVE, in date, unreserved).
      // Falls back to a name search only for a pharmacy-local medicine, which has
      // no catalogue id to query the engine by.
      fetchBatches: (name) => queryClient.fetchQuery({
        queryKey: item.medicineId
          ? queryKeys.dispensing.batches(item.medicineId, false)
          : queryKeys.medicineStock.byName(name),
        queryFn:  () => (item.medicineId
          ? api.get<{ data: InventoryBatch[] }>("/dispensing/batches", {
              params: { medicineId: item.medicineId },
            }).then((r) => r.data?.data ?? [])
          : api.get<{ data: { items: InventoryBatch[] } }>("/inventory", {
              params: { search: name, inStock: true, limit: 40, includeAlertCounts: false },
            }).then((r) => r.data?.data?.items ?? [])),
        staleTime: 30_000,
      }),
      addLine: addItem,
      notify: toast,
      batchesAreStrategyOrdered: !!item.medicineId,
    }),
  [addItem, toast, queryClient]);

  const handleQtySettled  = useCallback((item: CartItem, typed: number) => {
    reportClamp(item, typed, "quantity");
    // Only when the entry actually hit the batch ceiling — otherwise a normal typo cleanup would fetch batches.
    const settled = useBillingStore.getState().items.find((i) => i.inventoryId === item.inventoryId)?.quantity;
    if (settled != null && typed > settled && item.saleUnit === "LOOSE") {
      void handleLooseOverflow(item, typed);
    }
  }, [reportClamp, handleLooseOverflow]);
  const handleFreeSettled = useCallback((item: CartItem, typed: number) => reportClamp(item, typed, "freeQty"), [reportClamp]);

  const handleSwapBatch = useCallback(async (item: CartItem) => {
    setSwapTarget(item);
    try {
      // Cached briefly — reopening the swap picker for the same line right after
      // closing it (a common "let me double check" click) is served from cache
      // instead of hitting the network again.
      const items = await queryClient.fetchQuery({
        queryKey: queryKeys.medicineStock.byNameAll(item.medicineName),
        queryFn:  () => api.get<{ data: { items: InventoryBatch[] } }>("/inventory", {
          params: { search: item.medicineName, inStock: false, limit: 30, includeAlertCounts: false },
        }).then((r) => r.data?.data?.items ?? []),
        staleTime: 15_000,
      });
      const batches = [...items].sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
      setSwapBatches(batches);
    } catch {
      setSwapTarget(null);
    }
  }, [queryClient]);

  const handleBatchSelect = useCallback((batch: InventoryBatch) => {
    if (!swapTarget) return;
    // Keep the line on the same unit (Strip / loose) across the batch swap where
    // possible; the new batch carries its own opened-pack remainder and pack size.
    const nextUpp = batch.medicine.unitsPerPack ?? swapTarget.unitsPerPack ?? undefined;
    const nextAllow = batch.medicine.allowLooseSale ?? swapTarget.allowLooseSale ?? false;
    const next = nextLineAfterBatchSwap(swapTarget, nextAllow, nextUpp);

    replaceItem(swapTarget.inventoryId, {
      inventoryId:    batch.id,
      medicineId:     swapTarget.medicineId,
      medicineName:   batch.medicine.name,
      hsnCode:        batch.medicine.hsnCode,
      schedule:       swapTarget.schedule,
      packSize:       swapTarget.packSize,
      location:       getLocationLabel(batch) ?? undefined,
      batchNumber:    batch.batchNumber,
      expiryDate:     batch.expiryDate,
      mrp:            batch.mrp,
      quantity:       next.quantity,
      discount:       swapTarget.discount,
      gstRate:        batch.medicine.gstRate,
      availableStock: batch.quantity - (batch.reservedQuantity ?? 0),
      saleUnit:       next.saleUnit,
      unitsPerPack:   nextUpp,
      baseUnit:       batch.medicine.baseUnit ?? swapTarget.baseUnit ?? undefined,
      allowLooseSale: nextAllow,
      looseUnits:     batch.looseUnits ?? 0,
      // The pharmacist deliberately chose this batch over the engine's order.
      batchAutoSelected: false,
    });
    if (next.forcedToPack) {
      const packWord = saleUnitModel({
        baseUnit: batch.medicine.baseUnit ?? swapTarget.baseUnit,
        unitsPerPack: nextUpp, allowLooseSale: nextAllow, schedule: swapTarget.schedule,
      }).packUnitLabel;
      toast.warning(`${batch.medicine.name}: the new batch doesn't sell loose — ${swapTarget.quantity} `
        + `${baseUnitShort(swapTarget.baseUnit)} became ${next.quantity} whole `
        + `${pluraliseUnit(packWord, next.quantity)}. Check the quantity.`);
    }
    setSwapTarget(null);
    setSwapBatches([]);
  }, [swapTarget, replaceItem, toast]);

  /**
   * Record how many base units (mL/g) are in one sealed pack of a liquid/cream the
   * catalogue never classified. Writes this pharmacy's own override — NOT loose
   * selling (allowLooseSale stays false; a bottle still sells whole) — so a later
   * prescription for "150 mL" resolves to 2 bottles instead of the plain-count
   * fallback. Patches the live cart line too, so the fix shows without a reload.
   */
  const handleClassifyMeasured = useCallback(async (item: CartItem, unitsPerPack: number) => {
    if (!item.medicineId) return;
    try {
      await api.patch(`/medicines/${item.medicineId}/loose-settings`, {
        allowLooseSale: false, unitsPerPack, looseByDefault: false, confirmed: true,
      });
      patchLine(item.inventoryId, { unitsPerPack });
      void queryClient.invalidateQueries({ queryKey: ["medicine-search"] });
      toast.success(`${item.medicineName}: 1 pack = ${unitsPerPack}. Prescriptions will bill whole packs from now on.`);
    } catch (err) {
      toast.error(getErrorMessage(err, `Couldn't save the pack size for ${item.medicineName}`));
    }
  }, [patchLine, queryClient, toast]);

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
                onSaleUnitChange={setSaleUnit}
                onFixIssue={(id, patch) => patchLine(id, patch)}
                onSwapBatch={handleSwapBatch}
                onQtySettled={handleQtySettled}
                onFreeSettled={handleFreeSettled}
                onClassifyMeasured={canClassify ? handleClassifyMeasured : undefined}
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
