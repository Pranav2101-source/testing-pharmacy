"use client";
import { create } from "zustand";
import { calcGstFromMrp, calcInvoiceTotals } from "@pharmacy/utils";

export type CartItem = {
  inventoryId: string;
  medicineName: string;
  hsnCode: string | null;
  packSize?: string;
  location?: string;
  batchNumber: string;
  expiryDate: string;
  mrp: number;
  quantity: number;
  discount: number;
  gstRate: number;
  // computed
  rate: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  amount: number;
};

export type BillingMeta = {
  customerName: string;
  customerPhone: string;
  doctorName: string;
  paymentMode: "CASH" | "UPI" | "CARD" | "CREDIT";
  paymentStatus: "PAID" | "PENDING" | "PARTIAL";
  notes: string;
};

type BillingStore = {
  items: CartItem[];
  meta: BillingMeta;
  addItem: (base: Omit<CartItem, "rate" | "taxableAmount" | "cgst" | "sgst" | "amount">) => void;
  removeItem: (inventoryId: string) => void;
  updateQty: (inventoryId: string, qty: number) => void;
  updateDiscount: (inventoryId: string, discount: number) => void;
  setMeta: (patch: Partial<BillingMeta>) => void;
  clear: () => void;
  getTotals: () => ReturnType<typeof calcInvoiceTotals>;
};

const DEFAULT_META: BillingMeta = {
  customerName: "",
  customerPhone: "",
  doctorName: "",
  paymentMode: "CASH",
  paymentStatus: "PAID",
  notes: "",
};

function recompute(item: Omit<CartItem, "rate" | "taxableAmount" | "cgst" | "sgst" | "amount"> & Partial<CartItem>): CartItem {
  const { taxableAmount, cgst, sgst, totalAmount } = calcGstFromMrp(
    item.mrp,
    item.quantity,
    item.discount,
    item.gstRate
  );
  return {
    inventoryId: item.inventoryId,
    medicineName: item.medicineName,
    hsnCode: item.hsnCode,
    packSize: item.packSize,
    location: item.location,
    batchNumber: item.batchNumber,
    expiryDate: item.expiryDate,
    mrp: item.mrp,
    quantity: item.quantity,
    discount: item.discount,
    gstRate: item.gstRate,
    rate: Math.round(item.mrp * (1 - item.discount / 100) * 100) / 100,
    taxableAmount,
    cgst,
    sgst,
    amount: totalAmount,
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

  getTotals() {
    return calcInvoiceTotals(
      get().items.map((i) => ({
        mrp: i.mrp,
        quantity: i.quantity,
        discount: i.discount,
        gstRate: i.gstRate,
      }))
    );
  },
}));
