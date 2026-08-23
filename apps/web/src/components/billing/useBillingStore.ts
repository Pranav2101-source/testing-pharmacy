"use client";
import { create } from "zustand";
import { calcGstFromMrp, calcInvoiceTotals } from "@pharmacy/utils";

export type CartItem = {
  inventoryId:    string;
  medicineName:   string;
  hsnCode:        string | null;
  schedule:       string | null;
  packSize?:      string;
  location?:      string;
  batchNumber:    string;
  expiryDate:     string;
  mrp:            number;
  quantity:       number;
  /** Scheme quantity given free (10+1). Not charged; still leaves the shelf. */
  freeQty:        number;
  discount:       number;
  gstRate:        number;
  availableStock?: number;
  /**
   * The prescribed line this sale fulfils. Only ever set for a substitution: the
   * server attributes everything else by matching the medicine, which cannot work
   * when a different product was handed over.
   */
  prescriptionItemId?: string;
  // computed
  rate:           number;
  taxableAmount:  number;
  cgst:           number;
  sgst:           number;
  igst:           number;  // 0 for intra-state; full GST for interstate
  amount:         number;
};

export type BillingMeta = {
  customerId:              string;
  customerName:            string;
  customerPhone:           string;
  customerAddress:         string;
  abha:                    string;
  customerDefaultDiscount: number;
  doctorId:                string;
  doctorName:              string;
  prescriptionId:          string;  // DB id — required for Schedule H medicines
  prescriptionNumber:      string;  // human-readable "RX-00001" shown on receipts
  paymentMode:             "CASH" | "UPI" | "CARD" | "CREDIT";
  paymentStatus:           "PAID" | "PENDING" | "PARTIAL";
  isInterstate:            boolean;
  notes:                   string;  // internal notes
  deliveryNotes:           string;  // delivery instructions (shown on print)
  billDiscountPct:         number;  // bill-level discount % applied after item discounts
  extraCharges:            number;  // delivery / packaging / misc charge
  adjustmentAmount:        number;  // manual ± adjustment (rounding, goodwill, etc.)
};

/**
 * What a caller supplies when adding a line. Computed money fields are derived,
 * and freeQty is optional because most sales have no scheme — recompute() fills
 * in 0. The stored CartItem always carries a concrete freeQty.
 */
type NewCartItem =
  Omit<CartItem, "rate" | "taxableAmount" | "cgst" | "sgst" | "igst" | "amount" | "freeQty">
  & { freeQty?: number };

type BillingStore = {
  items: CartItem[];
  meta: BillingMeta;
  addItem: (base: NewCartItem) => void;
  removeItem: (inventoryId: string) => void;
  replaceItem: (oldInventoryId: string, base: NewCartItem) => void;
  updateQty: (inventoryId: string, qty: number) => void;
  updateFreeQty: (inventoryId: string, freeQty: number) => void;
  updateDiscount: (inventoryId: string, discount: number) => void;
  /** Attributes a cart line to a prescribed line. Pass null to clear. */
  linkToPrescriptionItem: (inventoryId: string, prescriptionItemId: string | null) => void;
  setMeta: (patch: Partial<BillingMeta>) => void;
  clear: () => void;
  getTotals: () => ReturnType<typeof calcInvoiceTotals>;
  loadDraft: (items: CartItem[], meta: BillingMeta) => void;
};

/**
 * Exported so a caller building a cart from scratch — a prescription being billed or parked
 * as a draft — can start from a clean bill rather than from whatever is half-typed in the
 * store right now, which would otherwise carry another customer's discount and payment mode
 * into it.
 */
export const DEFAULT_META: BillingMeta = {
  customerId:              "",
  customerName:            "",
  customerPhone:           "",
  customerAddress:         "",
  abha:                    "",
  customerDefaultDiscount: 0,
  doctorId:                "",
  doctorName:              "",
  prescriptionId:          "",
  prescriptionNumber:      "",
  paymentMode:             "CASH",
  paymentStatus:           "PAID",
  isInterstate:            false,
  notes:                   "",
  deliveryNotes:           "",
  billDiscountPct:         0,
  extraCharges:            0,
  adjustmentAmount:        0,
};

/**
 * Quantity a cart line is allowed to carry.
 *
 * Capped at the batch's available stock so the cashier cannot enter a quantity the
 * sale will be rejected for. The backend still re-checks under Serializable
 * isolation and remains the authority — it has to, because another till can sell
 * the same batch between this keystroke and Save — but the common case (one person
 * typing 50 when 3 are on the shelf) is now stopped at entry instead of after a
 * round trip.
 *
 * Two deliberate non-caps:
 *  - `availableStock` undefined means the caller never resolved it (some entry
 *    paths don't), and inventing a limit of 0 there would block legitimate sales.
 *  - `availableStock <= 0` still yields 1, because a cart line cannot represent
 *    zero. The backend rejects it by name ("Insufficient stock for X"), which is a
 *    clearer explanation than a row that silently refuses to accept input.
 */
function clampQuantity(quantity: number, availableStock?: number): number {
  // Floor first. Nothing downstream rounds — calcGstFromMrp multiplies mrp by this
  // number directly — so a quantity of 1.5 would quietly bill half a strip. Free
  // quantity has always floored; paid quantity did not, which is the half that
  // reaches the customer's total.
  //
  // Number.isFinite covers NaN and Infinity: Number("") is 0 and Number("1e999") is
  // Infinity, and both can arrive from an input the user is midway through editing.
  const whole = Number.isFinite(quantity) ? Math.floor(quantity) : 1;
  const atLeastOne = Math.max(1, whole);
  if (availableStock == null) return atLeastOne;
  if (availableStock <= 0) return 1;
  return Math.min(atLeastOne, availableStock);
}

/**
 * Paid quantity and free quantity share one batch, so the CAP APPLIES TO THEIR SUM.
 *
 * A 100-unit batch cannot support 95 sold + 10 free; checking each against the
 * batch separately would pass and then be rejected at save. The paid quantity wins
 * the remaining stock — a cashier who over-reaches on the scheme should lose the
 * free units, not the sale.
 */
function clampLine(quantity: number, freeQty: number, availableStock?: number): { quantity: number; freeQty: number } {
  const paid = clampQuantity(quantity, availableStock);
  // `|| 0` catches NaN as well as undefined; Math.floor(NaN) would survive otherwise.
  const free = Math.max(0, Math.floor(Number.isFinite(freeQty) ? freeQty : 0) || 0);
  if (availableStock == null || availableStock <= 0) return { quantity: paid, freeQty: free };
  return { quantity: paid, freeQty: Math.min(free, Math.max(0, availableStock - paid)) };
}

function recompute(item: NewCartItem & Partial<CartItem>): CartItem {
  const isInterstate = false; // item-level calc is always intra-state; IGST toggled at invoice level
  // Clamped here rather than at each call site: addItem, the addItem merge branch,
  // updateQty and replaceItem all funnel through this function, so a future entry
  // path cannot accidentally skip the cap.
  const { quantity, freeQty } = clampLine(item.quantity, item.freeQty ?? 0, item.availableStock);
  // Free units are NOT charged: every money figure below is derived from the paid
  // quantity alone. Only the stock cap above and the backend's decrement see the sum.
  const { taxableAmount, cgst, sgst, igst, totalAmount } = calcGstFromMrp(
    item.mrp,
    quantity,
    item.discount,
    item.gstRate,
    isInterstate,
  );
  return {
    inventoryId:    item.inventoryId,
    prescriptionItemId: item.prescriptionItemId,
    medicineName:   item.medicineName,
    hsnCode:        item.hsnCode,
    schedule:       item.schedule,
    packSize:       item.packSize,
    location:       item.location,
    batchNumber:    item.batchNumber,
    expiryDate:     item.expiryDate,
    mrp:            item.mrp,
    quantity,
    freeQty,
    discount:       item.discount,
    gstRate:        item.gstRate,
    availableStock: item.availableStock,
    rate:           Math.round(item.mrp * (1 - item.discount / 100) * 100) / 100,
    taxableAmount,
    cgst,
    sgst,
    igst,
    amount:         totalAmount,
  };
}

export const useBillingStore = create<BillingStore>((set, get) => ({
  items: [],
  meta: DEFAULT_META,

  addItem(base) {
    set((s) => {
      const existing = s.items.find((i) => i.inventoryId === base.inventoryId);
      if (existing) {
        return {
          items: s.items.map((i) =>
            i.inventoryId === base.inventoryId
              // Free units accumulate alongside paid ones: scanning a 10+1 pack twice
              // is 20 sold and 2 free, not 20 sold and 1 free.
              ? recompute({
                  ...i,
                  quantity: i.quantity + base.quantity,
                  freeQty:  (i.freeQty ?? 0) + (base.freeQty ?? 0),
                })
              : i
          ),
        };
      }
      return { items: [...s.items, recompute(base)] };
    });
  },

  removeItem(inventoryId) {
    set((s) => ({ items: s.items.filter((i) => i.inventoryId !== inventoryId) }));
  },

  replaceItem(oldInventoryId, base) {
    set((s) => ({
      items: s.items.map((i) =>
        i.inventoryId === oldInventoryId ? recompute(base) : i
      ),
    }));
  },

  updateQty(inventoryId, qty) {
    // No clamping here — recompute() owns it, so the floor of 1 and the
    // available-stock ceiling are applied identically on every path.
    set((s) => ({
      items: s.items.map((i) =>
        i.inventoryId === inventoryId ? recompute({ ...i, quantity: qty }) : i
      ),
    }));
  },

  updateFreeQty(inventoryId, freeQty) {
    // Clamping lives in recompute() so the paid+free total is checked against one
    // batch, same as every other edit path.
    set((s) => ({
      items: s.items.map((i) =>
        i.inventoryId === inventoryId ? recompute({ ...i, freeQty }) : i
      ),
    }));
  },

  updateDiscount(inventoryId, discount) {
    set((s) => ({
      items: s.items.map((i) =>
        i.inventoryId === inventoryId
          ? recompute({ ...i, discount: Math.min(100, Math.max(0, discount)) })
          : i
      ),
    }));
  },

  linkToPrescriptionItem(inventoryId, prescriptionItemId) {
    set((s) => ({
      items: s.items.map((i) => {
        // Two cart lines claiming the same prescribed line would credit it twice and could
        // close a prescription on half the medicine, so the link MOVES rather than copies.
        if (prescriptionItemId && i.prescriptionItemId === prescriptionItemId
            && i.inventoryId !== inventoryId) {
          return recompute({ ...i, prescriptionItemId: undefined });
        }
        return i.inventoryId === inventoryId
          ? recompute({ ...i, prescriptionItemId: prescriptionItemId ?? undefined })
          : i;
      }),
    }));
  },

  setMeta(patch) {
    // Attributions name lines on the prescription that WAS linked. Sending them against a
    // different one is either rejected or, worse, matched to a same-id line on the new Rx.
    if (patch.prescriptionId !== undefined && patch.prescriptionId !== get().meta.prescriptionId) {
      set((s) => ({ items: s.items.map((i) => recompute({ ...i, prescriptionItemId: undefined })) }));
    }
    set((s) => ({ meta: { ...s.meta, ...patch } }));
  },

  clear() {
    set({ items: [], meta: DEFAULT_META });
  },

  loadDraft(draftItems, draftMeta) {
    // Spread DEFAULT_META first so drafts saved before new fields were added
    // still get valid defaults for customerId / customerDefaultDiscount.
    set({ items: draftItems, meta: { ...DEFAULT_META, ...draftMeta } });
  },

  getTotals() {
    const { items, meta } = get();
    // The bill discount goes IN here, not on afterwards: it reduces the taxable value
    // (s.15(3) CGST Act), so the tax shown in the cart is the tax that will be charged.
    // The server computes the same way — see GstCalculator.calcInvoiceTotals.
    return calcInvoiceTotals(
      items.map((i) => ({ mrp: i.mrp, quantity: i.quantity, discount: i.discount, gstRate: i.gstRate })),
      meta.isInterstate,
      meta.billDiscountPct,
    );
  },
}));
