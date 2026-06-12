"use client";
import { create } from "zustand";
import { calcGstFromMrp, calcInvoiceTotals } from "@pharmacy/utils";

export type CartItem = {
  inventoryId:    string;
  medicineName:   string;
  hsnCode:        string | null;
  packSize?:      string;
  location?:      string;
  batchNumber:    string;
  expiryDate:     string;
  mrp:            number;
  quantity:       number;
  discount:       number;
  gstRate:        number;
  availableStock?: number;
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
  prescriptionId:          string;  // Rx number — required for Schedule H medicines
  paymentMode:             "CASH" | "UPI" | "CARD" | "CREDIT";
  paymentStatus:           "PAID" | "PENDING" | "PARTIAL";
  isInterstate:            boolean;
  notes:                   string;  // internal notes
  deliveryNotes:           string;  // delivery instructions (shown on print)
  billDiscountPct:         number;  // bill-level discount % applied after item discounts
  extraCharges:            number;  // delivery / packaging / misc charge
  adjustmentAmount:        number;  // manual ± adjustment (rounding, goodwill, etc.)
};

type BillingStore = {
  items: CartItem[];
  meta: BillingMeta;
  addItem: (base: Omit<CartItem, "rate" | "taxableAmount" | "cgst" | "sgst" | "igst" | "amount">) => void;
  removeItem: (inventoryId: string) => void;
  updateQty: (inventoryId: string, qty: number) => void;
  updateDiscount: (inventoryId: string, discount: number) => void;
  setMeta: (patch: Partial<BillingMeta>) => void;
  clear: () => void;
  getTotals: () => ReturnType<typeof calcInvoiceTotals>;
  loadDraft: (items: CartItem[], meta: BillingMeta) => void;
};

const DEFAULT_META: BillingMeta = {
  customerId:              "",
  customerName:            "",
  customerPhone:           "",
  customerAddress:         "",
  abha:                    "",
  customerDefaultDiscount: 0,
  doctorId:                "",
  doctorName:              "",
  prescriptionId:          "",
  paymentMode:             "CASH",
  paymentStatus:           "PAID",
  isInterstate:            false,
  notes:                   "",
  deliveryNotes:           "",
  billDiscountPct:         0,
  extraCharges:            0,
  adjustmentAmount:        0,
};

function recompute(item: Omit<CartItem, "rate" | "taxableAmount" | "cgst" | "sgst" | "igst" | "amount"> & Partial<CartItem>): CartItem {
  const isInterstate = false; // item-level calc is always intra-state; IGST toggled at invoice level
  const { taxableAmount, cgst, sgst, igst, totalAmount } = calcGstFromMrp(
    item.mrp,
    item.quantity,
    item.discount,
    item.gstRate,
    isInterstate,
  );
  return {
    inventoryId:    item.inventoryId,
    medicineName:   item.medicineName,
    hsnCode:        item.hsnCode,
    packSize:       item.packSize,
    location:       item.location,
    batchNumber:    item.batchNumber,
    expiryDate:     item.expiryDate,
    mrp:            item.mrp,
    quantity:       item.quantity,
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
              ? recompute({ ...i, quantity: i.quantity + base.quantity })
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

  updateQty(inventoryId, qty) {
    set((s) => ({
      items: s.items.map((i) =>
        i.inventoryId === inventoryId ? recompute({ ...i, quantity: Math.max(1, qty) }) : i
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

  setMeta(patch) {
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
    return calcInvoiceTotals(
      items.map((i) => ({ mrp: i.mrp, quantity: i.quantity, discount: i.discount, gstRate: i.gstRate })),
      meta.isInterstate,
    );
  },
}));
