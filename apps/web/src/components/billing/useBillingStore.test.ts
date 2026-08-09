import { beforeEach, describe, expect, it } from "vitest";
import { calcGstFromMrp } from "@pharmacy/utils";
import { useBillingStore, type CartItem } from "./useBillingStore";

/**
 * The point-of-sale cart. Everything a cashier sees on the bill screen is derived
 * from this store, and the numbers it produces must agree with what the backend
 * independently recomputes on save — a disagreement means the customer is charged
 * something other than what was on screen.
 *
 * Zustand stores are module singletons, so every test resets explicitly.
 */

type NewItem = Parameters<ReturnType<typeof useBillingStore.getState>["addItem"]>[0];

function item(overrides: Partial<NewItem> = {}): NewItem {
  return {
    inventoryId:  "inv-1",
    medicineName: "Dolo 650",
    hsnCode:      "3004",
    schedule:     null,
    batchNumber:  "B-1001",
    expiryDate:   "2027-12-31T00:00:00Z",
    mrp:          30,
    quantity:     1,
    discount:     0,
    gstRate:      12,
    availableStock: 100,
    ...overrides,
  };
}

const store = () => useBillingStore.getState();

/**
 * Indexed access under `noUncheckedIndexedAccess`.
 *
 * Throwing on a missing line is what we want anyway: a test that expected a cart
 * row and found none should fail on that fact, not on a downstream "possibly
 * undefined" from every property read.
 */
function line(index = 0): CartItem {
  const found = store().items[index];
  if (!found) throw new Error(`Expected a cart line at index ${index}, cart has ${store().items.length}`);
  return found;
}

beforeEach(() => {
  useBillingStore.getState().clear();
});

describe("addItem", () => {
  it("adds a new line and computes GST from the MRP", () => {
    store().addItem(item({ mrp: 112, quantity: 1, gstRate: 12 }));

    const expected = calcGstFromMrp(112, 1, 0, 12, false);
    expect(line().taxableAmount).toBe(expected.taxableAmount);
    expect(line().cgst).toBe(expected.cgst);
    expect(line().sgst).toBe(expected.sgst);
    expect(line().amount).toBe(expected.totalAmount);
  });

  it("splits GST into equal CGST and SGST halves for an intra-state sale", () => {
    store().addItem(item({ mrp: 100, quantity: 2, gstRate: 12 }));

    expect(line().cgst).toBe(line().sgst);
    expect(line().igst).toBe(0);
  });

  it("never puts IGST on a line — interstate is decided at invoice level", () => {
    // recompute() hardcodes isInterstate=false per line by design; the invoice-level
    // toggle is applied in getTotals. A line carrying IGST would double-count.
    store().setMeta({ isInterstate: true });
    store().addItem(item());
    expect(line().igst).toBe(0);
  });

  it("merges a repeat scan of the same batch into one line instead of duplicating", () => {
    // A cashier scanning the same strip twice must not get two rows — the backend
    // rejects duplicate inventoryIds in one invoice outright ("Duplicate inventory
    // items in a single invoice are not allowed"), so a duplicate row here would be
    // an unsaveable bill.
    store().addItem(item({ quantity: 2 }));
    store().addItem(item({ quantity: 3 }));

    expect(store().items).toHaveLength(1);
    expect(line().quantity).toBe(5);
  });

  it("recomputes the merged line's totals rather than leaving stale amounts", () => {
    store().addItem(item({ mrp: 100, quantity: 1, gstRate: 12 }));
    const single = line().amount;
    store().addItem(item({ mrp: 100, quantity: 1, gstRate: 12 }));

    // Compared against a fresh calculation at qty 2, NOT against `single * 2`.
    // GST is reverse-derived from a GST-inclusive MRP and rounded once per line, so
    // rounding at qty 1 and doubling gives 200.02 while the real qty-2 line is
    // 199.99. The line total is deliberately not linear in quantity; the contract is
    // "recomputed at the current quantity".
    expect(line().amount).toBe(calcGstFromMrp(100, 2, 0, 12, false).totalAmount);
    expect(line().amount).not.toBe(single);
  });

  it("keeps different batches of the same medicine as separate lines", () => {
    // Different expiry and MRP — they are genuinely different stock and each must
    // decrement its own batch.
    store().addItem(item({ inventoryId: "inv-1", batchNumber: "B-1", expiryDate: "2027-01-31T00:00:00Z" }));
    store().addItem(item({ inventoryId: "inv-2", batchNumber: "B-2", expiryDate: "2028-01-31T00:00:00Z" }));

    expect(store().items).toHaveLength(2);
  });

  it("caps a first add that already exceeds available stock", () => {
    // Reachable from the batch picker and from a barcode scan carrying a quantity.
    store().addItem(item({ quantity: 40, availableStock: 6 }));
    expect(line().quantity).toBe(6);
  });

  it("caps the merge branch — repeat scans cannot walk past the shelf count", () => {
    // The likeliest way to exceed stock in practice: scanning the same strip
    // repeatedly. Each scan is individually valid; the running total is not.
    store().addItem(item({ quantity: 2, availableStock: 3 }));
    store().addItem(item({ quantity: 2, availableStock: 3 }));
    expect(line().quantity).toBe(3);
  });

  it("handles a 0% GST medicine without producing NaN", () => {
    store().addItem(item({ mrp: 50, quantity: 2, gstRate: 0 }));

    expect(line().cgst).toBe(0);
    expect(line().sgst).toBe(0);
    expect(line().taxableAmount).toBe(100);
    expect(line().amount).toBe(100);
    expect(Number.isNaN(line().amount)).toBe(false);
  });
});

describe("updateQty", () => {
  it("clamps to a minimum of 1 — a zero-quantity line is not a sale", () => {
    store().addItem(item({ quantity: 5 }));
    store().updateQty("inv-1", 0);
    expect(line().quantity).toBe(1);
  });

  it("clamps a negative quantity to 1 rather than crediting the customer", () => {
    store().addItem(item({ quantity: 5 }));
    store().updateQty("inv-1", -3);
    expect(line().quantity).toBe(1);
    expect(line().amount).toBeGreaterThan(0);
  });

  it("recomputes the line total when the quantity changes", () => {
    store().addItem(item({ mrp: 100, quantity: 1, gstRate: 5 }));
    const before = line().amount;
    store().updateQty("inv-1", 4);

    // Recomputed at qty 4, not the qty-1 amount scaled — see the merge test above
    // for why per-line GST rounding makes those two figures differ by paise.
    expect(line().amount).toBe(calcGstFromMrp(100, 4, 0, 5, false).totalAmount);
    expect(line().amount).toBeGreaterThan(before);
  });

  it("ignores an id that is not in the cart", () => {
    store().addItem(item());
    store().updateQty("does-not-exist", 9);
    expect(line().quantity).toBe(1);
  });

  it("caps quantity at availableStock so an unsellable line cannot be entered", () => {
    // The cashier types 50 with 3 on the shelf. Stopping this at entry beats
    // stopping it at Save: the backend's rejection is correct but arrives after a
    // round trip, and the cart is already full of other items by then.
    store().addItem(item({ availableStock: 3 }));
    store().updateQty("inv-1", 50);
    expect(line().quantity).toBe(3);
  });

  it("recomputes the capped line's totals, not the requested quantity's", () => {
    // The displayed amount has to match the quantity actually being sold, or the
    // customer is quoted a total the bill will never carry.
    store().addItem(item({ mrp: 100, gstRate: 12, availableStock: 3 }));
    store().updateQty("inv-1", 50);
    expect(line().amount).toBe(calcGstFromMrp(100, 3, 0, 12, false).totalAmount);
  });

  it("allows a quantity exactly equal to availableStock", () => {
    // Selling the last three units is a normal sale, not an over-draw.
    store().addItem(item({ availableStock: 3 }));
    store().updateQty("inv-1", 3);
    expect(line().quantity).toBe(3);
  });

  it("does not cap when availableStock is unknown", () => {
    // Some entry paths never resolve stock. Treating undefined as a limit of zero
    // would block legitimate sales; the backend remains the guard there.
    store().addItem(item({ availableStock: undefined }));
    store().updateQty("inv-1", 50);
    expect(line().quantity).toBe(50);
  });

  it("falls back to 1 when the batch shows zero available", () => {
    // A cart line cannot represent zero. Keeping 1 lets the backend reject it by
    // name ("Insufficient stock for …"), which explains more than a row that
    // silently refuses input.
    store().addItem(item({ availableStock: 0 }));
    store().updateQty("inv-1", 10);
    expect(line().quantity).toBe(1);
  });

  it("still applies the floor of 1 alongside the ceiling", () => {
    store().addItem(item({ availableStock: 5 }));
    store().updateQty("inv-1", 0);
    expect(line().quantity).toBe(1);
  });
});

describe("free quantity (10+1 schemes)", () => {
  it("defaults to 0 when a caller does not supply it", () => {
    store().addItem(item());
    expect(line().freeQty).toBe(0);
  });

  it("records a scheme quantity without charging for it", () => {
    // The whole point: 10 paid + 1 free costs the same as 10.
    store().addItem(item({ mrp: 100, quantity: 10, gstRate: 12 }));
    const paidOnly = line().amount;

    store().updateFreeQty("inv-1", 1);
    expect(line().freeQty).toBe(1);
    expect(line().amount).toBe(paidOnly);
    expect(line().taxableAmount).toBe(calcGstFromMrp(100, 10, 0, 12, false).taxableAmount);
  });

  it("keeps free units out of the invoice totals", () => {
    store().addItem(item({ mrp: 100, quantity: 10, gstRate: 12, availableStock: 500 }));
    const before = store().getTotals();
    store().updateFreeQty("inv-1", 5);

    expect(store().getTotals().totalAmount).toBe(before.totalAmount);
    expect(store().getTotals().subtotal).toBe(before.subtotal);
  });

  it("floors a fractional free quantity — you cannot give away half a strip", () => {
    store().addItem(item({ availableStock: 100 }));
    store().updateFreeQty("inv-1", 2.7);
    expect(line().freeQty).toBe(2);
  });

  it("clamps a negative free quantity to 0", () => {
    store().addItem(item({ availableStock: 100 }));
    store().updateFreeQty("inv-1", -5);
    expect(line().freeQty).toBe(0);
  });

  /**
   * The rule that matters most. Paid and free units come off ONE batch, so the cap
   * is on their sum — checking each separately would let 95 sold + 10 free pass the
   * cart and then be rejected at save against a 100-unit batch.
   */
  it("caps paid + free against the SAME batch, not each separately", () => {
    store().addItem(item({ quantity: 95, availableStock: 100 }));
    store().updateFreeQty("inv-1", 10);

    expect(line().quantity).toBe(95);
    expect(line().freeQty).toBe(5);
    expect(line().quantity + line().freeQty).toBe(100);
  });

  it("gives the paid quantity priority over the scheme when stock runs out", () => {
    // Losing the free units is recoverable; losing the sale is not.
    store().addItem(item({ quantity: 100, availableStock: 100 }));
    store().updateFreeQty("inv-1", 10);

    expect(line().quantity).toBe(100);
    expect(line().freeQty).toBe(0);
  });

  it("re-caps free units when the paid quantity is raised afterwards", () => {
    store().addItem(item({ quantity: 50, availableStock: 100 }));
    store().updateFreeQty("inv-1", 40);
    expect(line().freeQty).toBe(40);

    store().updateQty("inv-1", 80);
    expect(line().quantity).toBe(80);
    expect(line().freeQty).toBe(20);
  });

  it("does not cap free units when availableStock is unknown", () => {
    store().addItem(item({ quantity: 10, availableStock: undefined }));
    store().updateFreeQty("inv-1", 99);
    expect(line().freeQty).toBe(99);
  });

  it("accumulates free units when the same batch is scanned again", () => {
    // Scanning a 10+1 pack twice is 20 sold and 2 free.
    store().addItem(item({ quantity: 10, freeQty: 1, availableStock: 500 }));
    store().addItem(item({ quantity: 10, freeQty: 1, availableStock: 500 }));

    expect(store().items).toHaveLength(1);
    expect(line().quantity).toBe(20);
    expect(line().freeQty).toBe(2);
  });

  it("carries free units across a batch swap, re-capped to the new batch", () => {
    store().addItem(item({ inventoryId: "inv-1", quantity: 10, freeQty: 5, availableStock: 100 }));
    store().replaceItem("inv-1", item({ inventoryId: "inv-2", quantity: 10, freeQty: 5, availableStock: 12 }));

    expect(line().inventoryId).toBe("inv-2");
    expect(line().quantity).toBe(10);
    expect(line().freeQty).toBe(2);
  });

  it("survives a discount change without losing the scheme", () => {
    store().addItem(item({ quantity: 10, freeQty: 2, availableStock: 100 }));
    store().updateDiscount("inv-1", 10);
    expect(line().freeQty).toBe(2);
  });

  it("ignores an id that is not in the cart", () => {
    store().addItem(item({ availableStock: 100 }));
    store().updateFreeQty("does-not-exist", 5);
    expect(line().freeQty).toBe(0);
  });
});

describe("updateDiscount", () => {
  it("clamps above 100% — a discount over the MRP would invert the line", () => {
    store().addItem(item({ mrp: 100 }));
    store().updateDiscount("inv-1", 150);
    expect(line().discount).toBe(100);
    expect(line().amount).toBe(0);
  });

  it("clamps a negative discount to 0 rather than marking the item up", () => {
    store().addItem(item({ mrp: 100 }));
    store().updateDiscount("inv-1", -20);
    expect(line().discount).toBe(0);
    expect(line().amount).toBeGreaterThan(0);
  });

  it("applies a normal discount to the rate and the amount together", () => {
    store().addItem(item({ mrp: 100, quantity: 1, gstRate: 12 }));
    store().updateDiscount("inv-1", 10);

    expect(line().rate).toBe(90);
    expect(line().amount).toBeCloseTo(calcGstFromMrp(100, 1, 10, 12, false).totalAmount, 2);
  });

  it("a 100% discount yields a zero-rupee line, which is legitimate", () => {
    // Free-of-charge dispensing (samples, goodwill) is a real pharmacy case and the
    // backend explicitly allows a zero total — only a NEGATIVE one is refused.
    store().addItem(item({ mrp: 100 }));
    store().updateDiscount("inv-1", 100);
    expect(line().amount).toBe(0);
  });
});

describe("removeItem / replaceItem", () => {
  it("removes only the targeted line", () => {
    store().addItem(item({ inventoryId: "inv-1" }));
    store().addItem(item({ inventoryId: "inv-2" }));
    store().removeItem("inv-1");

    expect(store().items).toHaveLength(1);
    expect(line().inventoryId).toBe("inv-2");
  });

  it("replaceItem swaps a batch in place, keeping cart order", () => {
    // This is the batch-picker flow: same medicine, different batch/expiry/MRP.
    store().addItem(item({ inventoryId: "inv-1" }));
    store().addItem(item({ inventoryId: "inv-9", medicineName: "Crocin" }));
    store().replaceItem("inv-1", item({ inventoryId: "inv-2", batchNumber: "B-2", mrp: 45 }));

    expect(store().items.map((i) => i.inventoryId)).toEqual(["inv-2", "inv-9"]);
    expect(line().mrp).toBe(45);
  });

  it("replaceItem caps against the NEW batch's stock, not the old one's", () => {
    // Swapping a 10-unit line onto a batch with 4 left must reduce the line;
    // carrying the old quantity across would push the new batch negative.
    store().addItem(item({ inventoryId: "inv-1", quantity: 10, availableStock: 50 }));
    store().replaceItem("inv-1", item({ inventoryId: "inv-2", quantity: 10, availableStock: 4 }));

    expect(line().inventoryId).toBe("inv-2");
    expect(line().quantity).toBe(4);
  });

  it("replaceItem recomputes totals for the new batch's MRP", () => {
    store().addItem(item({ inventoryId: "inv-1", mrp: 30, gstRate: 12 }));
    store().replaceItem("inv-1", item({ inventoryId: "inv-2", mrp: 60, gstRate: 12 }));

    expect(line().amount).toBeCloseTo(calcGstFromMrp(60, 1, 0, 12, false).totalAmount, 2);
  });
});

describe("getTotals", () => {
  it("returns zeroed totals for an empty cart without NaN", () => {
    const t = store().getTotals();
    expect(t.subtotal).toBe(0);
    expect(t.totalAmount).toBe(0);
    expect(Number.isNaN(t.totalGst)).toBe(false);
  });

  it("sums multiple lines", () => {
    store().addItem(item({ inventoryId: "inv-1", mrp: 100, quantity: 1, gstRate: 12 }));
    store().addItem(item({ inventoryId: "inv-2", mrp: 200, quantity: 2, gstRate: 5 }));

    expect(store().getTotals().subtotal).toBe(500);
  });

  it("switches CGST+SGST to IGST when the invoice is interstate", () => {
    store().addItem(item({ mrp: 100, quantity: 1, gstRate: 12 }));
    const intra = store().getTotals();
    expect(intra.igst).toBe(0);
    expect(intra.cgst).toBeGreaterThan(0);

    store().setMeta({ isInterstate: true });
    const inter = store().getTotals();
    expect(inter.cgst).toBe(0);
    expect(inter.sgst).toBe(0);
    expect(inter.igst).toBeGreaterThan(0);
  });

  it("keeps the payable total identical whether GST is split or not", () => {
    // The customer pays the same; only the CGST/SGST vs IGST split changes. A
    // difference here would mean interstate customers are charged differently.
    store().addItem(item({ mrp: 249, quantity: 3, gstRate: 12, discount: 7 }));
    const intra = store().getTotals();
    store().setMeta({ isInterstate: true });
    const inter = store().getTotals();

    expect(inter.totalAmount).toBeCloseTo(intra.totalAmount, 2);
  });

  it("reflects a discount in discountAmount", () => {
    store().addItem(item({ mrp: 100, quantity: 2, discount: 10, gstRate: 12 }));
    expect(store().getTotals().discountAmount).toBeCloseTo(20, 2);
  });

  it("cgst and sgst always match on an intra-state bill", () => {
    // Mixed slabs are where an uneven split would show up.
    store().addItem(item({ inventoryId: "a", mrp: 33.33, quantity: 3, gstRate: 5 }));
    store().addItem(item({ inventoryId: "b", mrp: 17.77, quantity: 7, gstRate: 12 }));
    store().addItem(item({ inventoryId: "c", mrp: 9.99, quantity: 1, gstRate: 0 }));

    const t = store().getTotals();
    expect(t.cgst).toBe(t.sgst);
    expect(t.taxableAmount + t.totalGst).toBeCloseTo(t.totalAmount, 2);
  });
});

describe("clear / loadDraft", () => {
  it("clear empties the cart AND resets meta — a stale customer must not carry over", () => {
    // Carrying the previous customer into the next sale would put one customer's
    // purchase on another's credit account.
    store().addItem(item());
    store().setMeta({ customerId: "cust-1", customerName: "Ramesh", paymentMode: "CREDIT" });
    store().clear();

    expect(store().items).toHaveLength(0);
    expect(store().meta.customerId).toBe("");
    expect(store().meta.customerName).toBe("");
    expect(store().meta.paymentMode).toBe("CASH");
  });

  it("clear resets bill-level adjustments too", () => {
    store().setMeta({ billDiscountPct: 15, extraCharges: 40, adjustmentAmount: -5 });
    store().clear();

    expect(store().meta.billDiscountPct).toBe(0);
    expect(store().meta.extraCharges).toBe(0);
    expect(store().meta.adjustmentAmount).toBe(0);
  });

  it("loadDraft fills defaults for fields a older draft never stored", () => {
    // Drafts are persisted in localStorage and survive deploys, so a draft saved
    // before a field existed must not load as undefined and produce NaN totals.
    const savedItems = [
      { ...item(), rate: 30, taxableAmount: 26.79, cgst: 1.61, sgst: 1.61, igst: 0, amount: 30 },
    ] as CartItem[];
    store().loadDraft(savedItems, { customerName: "Old Draft" } as never);

    expect(store().meta.customerName).toBe("Old Draft");
    expect(store().meta.billDiscountPct).toBe(0);
    expect(store().meta.extraCharges).toBe(0);
    expect(store().meta.paymentMode).toBe("CASH");
    expect(Number.isNaN(store().getTotals().totalAmount)).toBe(false);
  });

  it("loadDraft restores the cart lines", () => {
    const savedItems = [
      { ...item({ quantity: 4 }), rate: 30, taxableAmount: 107.14, cgst: 6.43, sgst: 6.43, igst: 0, amount: 120 },
    ] as CartItem[];
    store().loadDraft(savedItems, { customerName: "X" } as never);

    expect(store().items).toHaveLength(1);
    expect(line().quantity).toBe(4);
  });
});

describe("schedule-H awareness", () => {
  it("carries the schedule through so the bill screen can demand a prescription", () => {
    // The backend refuses a Schedule H/H1/X sale without a prescription; the cart
    // must retain the flag for the UI to prompt before that rejection happens.
    store().addItem(item({ schedule: "H", medicineName: "Alprazolam 0.5" }));
    expect(line().schedule).toBe("H");
  });

  it("keeps schedule intact across a quantity change", () => {
    store().addItem(item({ schedule: "H1" }));
    store().updateQty("inv-1", 3);
    expect(line().schedule).toBe("H1");
  });

  it("keeps expiry and batch number intact across a discount change", () => {
    // These print on the invoice and are a legal requirement on an Indian pharmacy
    // bill; losing them in a recompute would produce a non-compliant invoice.
    store().addItem(item({ batchNumber: "B-777", expiryDate: "2027-06-30T00:00:00Z" }));
    store().updateDiscount("inv-1", 5);

    expect(line().batchNumber).toBe("B-777");
    expect(line().expiryDate).toBe("2027-06-30T00:00:00Z");
    expect(line().hsnCode).toBe("3004");
  });
});

/**
 * The QA report behind this block: "selecting the quantity of medicine via keyboard
 * not getting populated properly in the UI, hence calculating final price is
 * reflected incorrect."
 *
 * The cell used to be bound straight to the clamped number, so an empty field became
 * Number("") === 0, the floor of 1 turned that back into 1, and the digit the cashier
 * had just deleted reappeared under the caret. These lock down the arithmetic the
 * cell now relies on; CartTable's NumericCell owns the "may be empty while focused"
 * half.
 */
describe("quantity entry", () => {
  it("never lets a non-number reach the total", () => {
    // Number("") is 0 and Number("1e999") is Infinity — both arrive from an input
    // that is midway through being edited.
    store().addItem(item({ quantity: 4 }));

    store().updateQty("inv-1", Number(""));
    expect(line().quantity).toBe(1);

    store().updateQty("inv-1", Number.NaN);
    expect(line().quantity).toBe(1);

    store().updateQty("inv-1", Number.POSITIVE_INFINITY);
    expect(line().quantity).toBe(1);
    expect(Number.isFinite(store().getTotals().totalAmount)).toBe(true);
  });

  it("floors a fractional quantity instead of pricing half a strip", () => {
    // calcGstFromMrp multiplies mrp by this number directly: 1.5 x Rs.30 would bill
    // Rs.45 for one and a half strips of tablets, which cannot be dispensed.
    store().addItem(item({ mrp: 30, quantity: 1, gstRate: 0, availableStock: 100 }));
    store().updateQty("inv-1", 1.5);

    expect(line().quantity).toBe(1);
    expect(line().amount).toBe(30);
    expect(Number.isInteger(line().quantity)).toBe(true);
  });

  it("floors free quantity the same way", () => {
    store().addItem(item({ quantity: 1, availableStock: 100 }));
    store().updateFreeQty("inv-1", 2.9);
    expect(line().freeQty).toBe(2);

    store().updateFreeQty("inv-1", Number.NaN);
    expect(line().freeQty).toBe(0);
  });

  it("still caps at available stock, and the cap is reportable", () => {
    // The cap is correct — the sale would be rejected at save otherwise. What the UI
    // now does with it is tell the cashier, which needs the settled value to differ
    // from the typed one in an observable way.
    store().addItem(item({ quantity: 1, availableStock: 3 }));
    store().updateQty("inv-1", 25);

    expect(line().quantity).toBe(3);
    expect(line().quantity).not.toBe(25);
  });

  it("prices exactly the quantity typed when stock allows", () => {
    // The end of the reported bug: intending 25 and being charged for 125.
    store().addItem(item({ mrp: 30, quantity: 1, gstRate: 0, availableStock: 1000 }));
    store().updateQty("inv-1", 25);

    expect(line().quantity).toBe(25);
    expect(line().amount).toBe(750);
    expect(store().getTotals().totalAmount).toBe(750);
  });
});
