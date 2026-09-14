import { beforeEach, describe, expect, it } from "vitest";
import type { BillingMeta, CartItem } from "@/components/billing/useBillingStore";
import {
  clearAllDrafts,
  deleteDraft,
  getDraft,
  listDrafts,
  saveDraft,
  type DraftBill,
} from "./draftStorage";

/**
 * Parked bills. A cashier parks a bill when a customer goes back for another item
 * or steps away to fetch money, then serves the next person. Losing one means
 * re-entering an entire basket at the counter with a queue waiting, so the
 * behaviour under test is mostly "nothing is silently dropped or mixed up".
 */

const KEY = "checkup_billing_drafts";

function cartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    inventoryId:   "inv-1",
    medicineName:  "Dolo 650",
    hsnCode:       "3004",
    schedule:      null,
    batchNumber:   "B-1001",
    expiryDate:    "2027-12-31T00:00:00Z",
    mrp:           30,
    quantity:      2,
    freeQty:       0,
    discount:      0,
    gstRate:       12,
    rate:          30,
    taxableAmount: 53.57,
    cgst:          3.21,
    sgst:          3.21,
    igst:          0,
    amount:        60,
    ...overrides,
  };
}

function meta(overrides: Partial<BillingMeta> = {}): BillingMeta {
  return {
    customerId:              "",
    customerName:            "",
    customerPhone:           "",
    customerAddress:         "",
    abha:                    "",
    customerAdvanceBalance:  0,
    customerDefaultDiscount: 0,
    doctorId:                "",
    doctorName:              "",
    prescriptionId:          "",
    prescriptionNumber:      "",
    paymentMode:             "CASH",
    paymentStatus:           "PAID",
    tenders:                 [],
    isInterstate:            false,
    notes:                   "",
    deliveryNotes:           "",
    billDiscountPct:         0,
    extraCharges:            0,
    adjustmentAmount:        0,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("saving", () => {
  it("stores a draft that can be listed and fetched back intact", () => {
    const saved = saveDraft([cartItem()], meta({ customerName: "Ramesh" }));

    expect(listDrafts()).toHaveLength(1);
    const fetched = getDraft(saved.id);
    expect(fetched?.items).toHaveLength(1);
    expect(fetched?.items[0]?.medicineName).toBe("Dolo 650");
    expect(fetched?.meta.customerName).toBe("Ramesh");
  });

  it("preserves the computed line amounts, not just the inputs", () => {
    // The parked bill must restore to the same total the cashier already quoted.
    const saved = saveDraft([cartItem({ amount: 60, cgst: 3.21, sgst: 3.21 })], meta());
    const fetched = getDraft(saved.id);

    expect(fetched?.items[0]?.amount).toBe(60);
    expect(fetched?.items[0]?.cgst).toBe(3.21);
  });

  it("gives every draft a distinct id", () => {
    const a = saveDraft([cartItem()], meta());
    const b = saveDraft([cartItem()], meta());
    expect(a.id).not.toBe(b.id);
  });

  it("puts the newest draft first", () => {
    const first = saveDraft([cartItem()], meta({ customerName: "First" }));
    const second = saveDraft([cartItem()], meta({ customerName: "Second" }));

    const all = listDrafts();
    expect(all[0]?.id).toBe(second.id);
    expect(all[1]?.id).toBe(first.id);
  });

  it("keeps multiple parked bills rather than overwriting", () => {
    // The realistic case: three customers parked at once during a rush.
    saveDraft([cartItem({ inventoryId: "a" })], meta({ customerName: "A" }));
    saveDraft([cartItem({ inventoryId: "b" })], meta({ customerName: "B" }));
    saveDraft([cartItem({ inventoryId: "c" })], meta({ customerName: "C" }));

    expect(listDrafts()).toHaveLength(3);
    expect(listDrafts().map((d) => d.meta.customerName)).toEqual(["C", "B", "A"]);
  });

  it("records a savedAt timestamp", () => {
    const saved = saveDraft([cartItem()], meta());
    expect(Number.isNaN(Date.parse(saved.savedAt))).toBe(false);
  });

  it("saves an empty cart without throwing", () => {
    expect(() => saveDraft([], meta())).not.toThrow();
    expect(listDrafts()).toHaveLength(1);
  });
});

describe("labelling", () => {
  it("uses the customer's name when there is a real customer", () => {
    const saved = saveDraft([cartItem()], meta({ customerId: "c-1", customerName: "Ramesh" }));
    expect(saved.label).toContain("Ramesh");
  });

  it("falls back to a generic label for a walk-in counter sale", () => {
    // COUNTER is the anonymous walk-in; labelling it "COUNTER — 3:42 PM" would be
    // meaningless when several are parked at once.
    const saved = saveDraft([cartItem()], meta({ customerId: "COUNTER", customerName: "Counter" }));
    expect(saved.label).toMatch(/^Draft —/);
  });

  it("falls back to a generic label when no customer name was entered", () => {
    const saved = saveDraft([cartItem()], meta({ customerName: "   " }));
    expect(saved.label).toMatch(/^Draft —/);
  });
});

describe("fetching and deleting", () => {
  it("returns null for an unknown id rather than throwing", () => {
    expect(getDraft("no-such-draft")).toBeNull();
  });

  it("deletes only the targeted draft", () => {
    const keep = saveDraft([cartItem()], meta({ customerName: "Keep" }));
    const drop = saveDraft([cartItem()], meta({ customerName: "Drop" }));

    deleteDraft(drop.id);

    expect(listDrafts()).toHaveLength(1);
    expect(listDrafts()[0]?.id).toBe(keep.id);
    expect(getDraft(drop.id)).toBeNull();
  });

  it("deleting an unknown id is a no-op, not a wipe", () => {
    saveDraft([cartItem()], meta());
    deleteDraft("no-such-draft");
    expect(listDrafts()).toHaveLength(1);
  });

  it("clearAllDrafts empties the list", () => {
    saveDraft([cartItem()], meta());
    saveDraft([cartItem()], meta());
    clearAllDrafts();
    expect(listDrafts()).toEqual([]);
  });
});

describe("resilience to bad stored data", () => {
  it("reports no drafts when storage is empty", () => {
    expect(listDrafts()).toEqual([]);
  });

  it("recovers from corrupt JSON instead of breaking the billing screen", () => {
    // A truncated write (tab killed mid-save, quota hit) must not take down the
    // till — the drafts list is a convenience, not something worth crashing over.
    localStorage.setItem(KEY, "{not json");
    expect(listDrafts()).toEqual([]);
  });

  it("recovers when the stored value is valid JSON but not an array", () => {
    localStorage.setItem(KEY, JSON.stringify({ unexpected: "shape" }));
    expect(listDrafts()).toEqual([]);
  });

  it("can save again after encountering corrupt storage", () => {
    localStorage.setItem(KEY, "{not json");
    const saved = saveDraft([cartItem()], meta({ customerName: "After Corruption" }));

    expect(listDrafts()).toHaveLength(1);
    expect(getDraft(saved.id)?.meta.customerName).toBe("After Corruption");
  });

  it("survives a draft saved before newer meta fields existed", () => {
    // Drafts outlive deploys. An old shape must still load; useBillingStore's
    // loadDraft is what fills the missing defaults.
    const legacy = [{
      id: "old-1",
      label: "Legacy draft",
      savedAt: new Date().toISOString(),
      items: [cartItem()],
      meta: { customerName: "Old Customer", paymentMode: "CASH" },
    }] as unknown as DraftBill[];
    localStorage.setItem(KEY, JSON.stringify(legacy));

    const fetched = getDraft("old-1");
    expect(fetched).not.toBeNull();
    expect(fetched?.meta.customerName).toBe("Old Customer");
  });
});
