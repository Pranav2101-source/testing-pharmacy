import { describe, it, expect } from "vitest";
import { calcGstFromMrp, calcInvoiceTotals, calcPurchaseLineGST } from "./gst.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Every result must satisfy these invariants regardless of inputs. */
function assertInvariants(r: ReturnType<typeof calcGstFromMrp>) {
  expect(r.cgst + r.sgst + r.igst).toBeCloseTo(r.totalGst, 10);
  // `totalAmount` is the price the customer pays (MRP x qty less discount), NOT a sum of
  // the rounded tax parts. Intra-state, the equal CGST/SGST split can leave (taxable + tax)
  // a paisa either side of it — see calcGstFromMrp. So this reconciles to within one paisa,
  // not exactly.
  expect(Math.abs(r.taxableAmount + r.totalGst - r.totalAmount)).toBeLessThanOrEqual(0.01 + 1e-9);
  // intra-state and inter-state are mutually exclusive
  const isInterstate = r.igst > 0;
  if (isInterstate) {
    expect(r.cgst).toBe(0);
    expect(r.sgst).toBe(0);
  } else {
    expect(r.igst).toBe(0);
  }
}

// ── calcGstFromMrp ───────────────────────────────────────────────────────────

describe("calcGstFromMrp", () => {

  // ── 0 % GST (GST-exempt medicines) ──────────────────────────────────────────

  describe("0% GST", () => {
    it("no tax: taxableAmount equals totalAmount", () => {
      const r = calcGstFromMrp(100, 1, 0, 0);
      expect(r.taxableAmount).toBe(100);
      expect(r.totalGst).toBe(0);
      expect(r.cgst).toBe(0);
      expect(r.sgst).toBe(0);
      expect(r.igst).toBe(0);
      expect(r.totalAmount).toBe(100);
      assertInvariants(r);
    });

    it("0% GST with quantity and discount", () => {
      const r = calcGstFromMrp(100, 2, 10, 0);
      expect(r.taxableAmount).toBe(180);
      expect(r.totalGst).toBe(0);
      expect(r.totalAmount).toBe(180);
      assertInvariants(r);
    });
  });

  // ── 5 % GST ──────────────────────────────────────────────────────────────────

  describe("5% GST — intrastate", () => {
    it("₹105 MRP, qty 1, no discount", () => {
      const r = calcGstFromMrp(105, 1, 0, 5);
      expect(r.taxableAmount).toBe(100);
      expect(r.cgst).toBe(2.5);
      expect(r.sgst).toBe(2.5);
      expect(r.igst).toBe(0);
      expect(r.totalGst).toBe(5);
      expect(r.totalAmount).toBe(105);
      assertInvariants(r);
    });

    it("CGST === SGST (symmetric split)", () => {
      const r = calcGstFromMrp(210, 1, 0, 5);
      expect(r.cgst).toBe(r.sgst);
      assertInvariants(r);
    });

    it("discount applied before GST reverse-calculation", () => {
      // ₹105 MRP, 10% discount → effective ₹94.50 (GST-inclusive)
      const r = calcGstFromMrp(105, 1, 10, 5);
      expect(r.taxableAmount).toBe(90);
      expect(r.cgst).toBe(2.25);
      expect(r.sgst).toBe(2.25);
      expect(r.totalGst).toBe(4.5);
      expect(r.totalAmount).toBe(94.5);
      assertInvariants(r);
    });

    it("qty 3, no discount", () => {
      const r = calcGstFromMrp(105, 3, 0, 5);
      expect(r.taxableAmount).toBe(300);
      expect(r.totalGst).toBe(15);
      expect(r.totalAmount).toBe(315);
      assertInvariants(r);
    });

    it("qty 5, 20% discount", () => {
      // lineTotal = 525, discount = 105, after = 420
      // taxable = 420/1.05 = 400
      const r = calcGstFromMrp(105, 5, 20, 5);
      expect(r.taxableAmount).toBe(400);
      expect(r.totalAmount).toBe(420);
      assertInvariants(r);
    });
  });

  describe("5% GST — interstate", () => {
    it("IGST = full rate, CGST = SGST = 0", () => {
      const r = calcGstFromMrp(105, 1, 0, 5, true);
      expect(r.igst).toBe(5);
      expect(r.cgst).toBe(0);
      expect(r.sgst).toBe(0);
      expect(r.totalGst).toBe(5);
      assertInvariants(r);
    });

    it("interstate totalAmount equals intrastate totalAmount", () => {
      const intra = calcGstFromMrp(105, 2, 10, 5, false);
      const inter = calcGstFromMrp(105, 2, 10, 5, true);
      expect(inter.totalAmount).toBe(intra.totalAmount);
      expect(inter.taxableAmount).toBe(intra.taxableAmount);
    });
  });

  // ── 12 % GST ─────────────────────────────────────────────────────────────────

  describe("12% GST — intrastate", () => {
    it("₹112 MRP, qty 1, no discount", () => {
      const r = calcGstFromMrp(112, 1, 0, 12);
      expect(r.taxableAmount).toBe(100);
      expect(r.cgst).toBe(6);
      expect(r.sgst).toBe(6);
      expect(r.totalGst).toBe(12);
      expect(r.totalAmount).toBe(112);
      assertInvariants(r);
    });

    it("₹112 MRP, 15% discount", () => {
      // lineTotal=112, discount=16.8, after=95.2
      // taxable = 95.2/1.12 ≈ 85
      const r = calcGstFromMrp(112, 1, 15, 12);
      expect(r.taxableAmount).toBeCloseTo(85, 1);
      expect(r.totalAmount).toBeCloseTo(95.2, 2);
      assertInvariants(r);
    });

    it("qty 10, no discount", () => {
      const r = calcGstFromMrp(112, 10, 0, 12);
      expect(r.taxableAmount).toBe(1000);
      expect(r.totalGst).toBe(120);
      expect(r.totalAmount).toBe(1120);
      assertInvariants(r);
    });

    it("a clean ₹90 x 2 line totals exactly ₹180.00, not ₹179.99", () => {
      // The live-review case: MRP 90, qty 2, 12% GST inclusive. The line total is the
      // price paid (180.00); the odd tax paisa lands in the breakdown, not the total.
      const r = calcGstFromMrp(90, 2, 0, 12);
      expect(r.totalAmount).toBe(180);
      expect(r.cgst).toBe(r.sgst);
      expect(r.taxableAmount + r.totalGst).toBeCloseTo(179.99, 2); // a paisa under, by design
    });
  });

  describe("12% GST — interstate", () => {
    it("IGST = 12, CGST = SGST = 0", () => {
      const r = calcGstFromMrp(112, 1, 0, 12, true);
      expect(r.igst).toBe(12);
      expect(r.cgst).toBe(0);
      expect(r.sgst).toBe(0);
      assertInvariants(r);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("100% discount → all amounts are zero", () => {
      const r = calcGstFromMrp(105, 1, 100, 5);
      expect(r.taxableAmount).toBe(0);
      expect(r.totalGst).toBe(0);
      expect(r.totalAmount).toBe(0);
      assertInvariants(r);
    });

    it("zero quantity → all amounts are zero", () => {
      const r = calcGstFromMrp(105, 0, 0, 5);
      expect(r.taxableAmount).toBe(0);
      expect(r.totalAmount).toBe(0);
      assertInvariants(r);
    });

    it("zero MRP → all amounts are zero", () => {
      const r = calcGstFromMrp(0, 5, 0, 12);
      expect(r.totalAmount).toBe(0);
      assertInvariants(r);
    });

    it("rounding: cgst + sgst never has floating-point drift", () => {
      // Pick values known to produce repeating decimals
      const r = calcGstFromMrp(111, 3, 7, 5);
      // cgst + sgst must equal totalGst exactly (not 4.9999999...)
      expect(r.cgst + r.sgst).toBe(r.totalGst);
      // The line total is the discounted price paid: 111 x 3 = 333, less 7% = 309.69.
      expect(r.totalAmount).toBe(309.69);
      assertInvariants(r);
    });
  });
});

// ── calcInvoiceTotals ─────────────────────────────────────────────────────────

describe("calcInvoiceTotals", () => {

  it("empty items → all zeros", () => {
    const r = calcInvoiceTotals([]);
    expect(r.subtotal).toBe(0);
    expect(r.discountAmount).toBe(0);
    expect(r.taxableAmount).toBe(0);
    expect(r.totalGst).toBe(0);
    expect(r.totalAmount).toBe(0);
  });

  it("single item matches calcGstFromMrp", () => {
    const item = { mrp: 112, quantity: 1, discount: 0, gstRate: 12 };
    const totals = calcInvoiceTotals([item]);
    const line   = calcGstFromMrp(112, 1, 0, 12);

    expect(totals.taxableAmount).toBe(line.taxableAmount);
    expect(totals.totalGst).toBe(line.totalGst);
    expect(totals.totalAmount).toBe(line.totalAmount);
    expect(totals.cgst).toBe(line.cgst);
    expect(totals.sgst).toBe(line.sgst);
  });

  it("subtotal = sum of mrp × qty before discount", () => {
    const items = [
      { mrp: 100, quantity: 2, discount: 0,  gstRate: 5  },
      { mrp: 200, quantity: 1, discount: 10, gstRate: 12 },
    ];
    const r = calcInvoiceTotals(items);
    expect(r.subtotal).toBe(400); // 100×2 + 200×1
  });

  it("discountAmount = sum of per-line discounts", () => {
    const items = [
      { mrp: 100, quantity: 2, discount: 10, gstRate: 5  }, // discount = 20
      { mrp: 200, quantity: 1, discount: 20, gstRate: 12 }, // discount = 40
    ];
    const r = calcInvoiceTotals(items);
    expect(r.discountAmount).toBe(60);
  });

  it("mixed GST rates intrastate — cgst = sgst, igst = 0", () => {
    const items = [
      { mrp: 105, quantity: 1, discount: 0, gstRate: 5  },
      { mrp: 112, quantity: 1, discount: 0, gstRate: 12 },
    ];
    const r = calcInvoiceTotals(items);
    expect(r.cgst).toBe(r.sgst);
    expect(r.igst).toBe(0);
    expect(r.cgst + r.sgst).toBe(r.totalGst);
    expect(r.taxableAmount + r.totalGst).toBe(r.totalAmount);
  });

  it("mixed GST rates interstate — igst = totalGst, cgst = sgst = 0", () => {
    const items = [
      { mrp: 105, quantity: 1, discount: 0, gstRate: 5,  isInterstate: true },
      { mrp: 112, quantity: 1, discount: 0, gstRate: 12, isInterstate: true },
    ];
    const r = calcInvoiceTotals(items, true);
    expect(r.cgst).toBe(0);
    expect(r.sgst).toBe(0);
    expect(r.igst).toBe(r.totalGst);
    expect(r.taxableAmount + r.totalGst).toBe(r.totalAmount);
  });

  it("intra and interstate totals produce same totalAmount", () => {
    const items = [
      { mrp: 105, quantity: 2, discount: 5, gstRate: 5 },
      { mrp: 112, quantity: 3, discount: 0, gstRate: 12 },
    ];
    const intra = calcInvoiceTotals(items, false);
    const inter = calcInvoiceTotals(items, true);
    expect(inter.totalAmount).toBe(intra.totalAmount);
    expect(inter.taxableAmount).toBe(intra.taxableAmount);
  });

  it("large invoice — rounding invariants hold", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      mrp:      111 + i,
      quantity: 3,
      discount: 7,
      gstRate:  i % 2 === 0 ? 5 : 12,
    }));
    const r = calcInvoiceTotals(items);
    expect(r.cgst + r.sgst).toBe(r.totalGst);
    // Header total = sum of the per-line prices paid; (taxable + tax) reconciles to within
    // one paisa per line (equal CGST/SGST split), so a few paise across a 10-line bill.
    expect(Math.abs(r.taxableAmount + r.totalGst - r.totalAmount)).toBeLessThanOrEqual(0.1);
  });

  it("all 100% discounted items → totalAmount is zero", () => {
    const items = [
      { mrp: 100, quantity: 2, discount: 100, gstRate: 5  },
      { mrp: 200, quantity: 1, discount: 100, gstRate: 12 },
    ];
    const r = calcInvoiceTotals(items);
    expect(r.totalAmount).toBe(0);
    expect(r.totalGst).toBe(0);
  });
});

// ── calcPurchaseLineGST ───────────────────────────────────────────────────────
// Purchase-side: cost price is GST-EXCLUSIVE (tax added ON TOP).
// Opposite of calcGstFromMrp which reverse-calculates from GST-inclusive MRP.

describe("calcPurchaseLineGST", () => {

  // ── 0% GST ───────────────────────────────────────────────────────────────────

  describe("0% GST", () => {
    it("amount equals lineTotal when no GST", () => {
      const r = calcPurchaseLineGST(100, 1, 0, 0);
      expect(r.lineTotal).toBe(100);
      expect(r.totalGst).toBe(0);
      expect(r.cgst).toBe(0);
      expect(r.sgst).toBe(0);
      expect(r.igst).toBe(0);
      expect(r.amount).toBe(100);
    });

    it("qty 5, 0% GST: amount = lineTotal = 500", () => {
      const r = calcPurchaseLineGST(100, 5, 0, 0);
      expect(r.lineTotal).toBe(500);
      expect(r.amount).toBe(500);
      expect(r.totalGst).toBe(0);
    });
  });

  // ── 5% GST — intrastate ───────────────────────────────────────────────────────

  describe("5% GST — intrastate", () => {
    it("₹100 cost, qty 1, no discount: cgst=sgst=2.5, amount=105", () => {
      const r = calcPurchaseLineGST(100, 1, 0, 5);
      expect(r.lineTotal).toBe(100);
      expect(r.cgst).toBe(2.5);
      expect(r.sgst).toBe(2.5);
      expect(r.igst).toBe(0);
      expect(r.totalGst).toBe(5);
      expect(r.amount).toBe(105);
    });

    it("cgst === sgst (symmetric split)", () => {
      const r = calcPurchaseLineGST(200, 3, 0, 5);
      expect(r.cgst).toBe(r.sgst);
    });

    it("qty 10: lineTotal=1000, gst=50, amount=1050", () => {
      const r = calcPurchaseLineGST(100, 10, 0, 5);
      expect(r.lineTotal).toBe(1000);
      expect(r.totalGst).toBe(50);
      expect(r.amount).toBe(1050);
    });

    it("10% discount: lineTotal=90, cgst=sgst=2.25, amount=94.5", () => {
      const r = calcPurchaseLineGST(100, 1, 10, 5);
      expect(r.lineTotal).toBe(90);
      expect(r.cgst).toBe(2.25);
      expect(r.sgst).toBe(2.25);
      expect(r.totalGst).toBe(4.5);
      expect(r.amount).toBe(94.5);
    });
  });

  // ── 5% GST — interstate ───────────────────────────────────────────────────────

  describe("5% GST — interstate", () => {
    it("igst = full 5%, cgst = sgst = 0", () => {
      const r = calcPurchaseLineGST(100, 1, 0, 5, true);
      expect(r.igst).toBe(5);
      expect(r.cgst).toBe(0);
      expect(r.sgst).toBe(0);
      expect(r.totalGst).toBe(5);
      expect(r.amount).toBe(105);
    });

    it("interstate and intrastate produce same amount", () => {
      const intra = calcPurchaseLineGST(200, 2, 10, 5, false);
      const inter = calcPurchaseLineGST(200, 2, 10, 5, true);
      expect(inter.amount).toBe(intra.amount);
      expect(inter.lineTotal).toBe(intra.lineTotal);
    });
  });

  // ── 12% GST ───────────────────────────────────────────────────────────────────

  describe("12% GST — intrastate", () => {
    it("₹100 cost, qty 1: cgst=sgst=6, amount=112", () => {
      const r = calcPurchaseLineGST(100, 1, 0, 12);
      expect(r.cgst).toBe(6);
      expect(r.sgst).toBe(6);
      expect(r.totalGst).toBe(12);
      expect(r.amount).toBe(112);
    });

    it("20% discount: lineTotal=80, gst=9.6, amount=89.6", () => {
      const r = calcPurchaseLineGST(100, 1, 20, 12);
      expect(r.lineTotal).toBe(80);
      expect(r.totalGst).toBe(9.6);
      expect(r.amount).toBe(89.6);
    });

    it("12% interstate: igst=12, cgst=sgst=0", () => {
      const r = calcPurchaseLineGST(100, 1, 0, 12, true);
      expect(r.igst).toBe(12);
      expect(r.cgst).toBe(0);
      expect(r.sgst).toBe(0);
    });
  });

  // ── Invariants ────────────────────────────────────────────────────────────────

  describe("invariants", () => {
    it("lineTotal + totalGst === amount for all combinations", () => {
      const cases = [
        [50, 2, 0, 0], [100, 1, 10, 5], [200, 3, 15, 12], [500, 1, 0, 18],
      ] as [number, number, number, number][];
      for (const [cost, qty, disc, gst] of cases) {
        const r = calcPurchaseLineGST(cost, qty, disc, gst);
        expect(r.lineTotal + r.totalGst).toBeCloseTo(r.amount, 10);
      }
    });

    it("cgst + sgst === totalGst for intrastate", () => {
      const r = calcPurchaseLineGST(111, 3, 7, 5);
      expect(r.cgst + r.sgst).toBe(r.totalGst);
    });

    it("100% discount → lineTotal=0, gst=0, amount=0", () => {
      const r = calcPurchaseLineGST(100, 5, 100, 12);
      expect(r.lineTotal).toBe(0);
      expect(r.totalGst).toBe(0);
      expect(r.amount).toBe(0);
    });

    it("zero quantity → all zeros", () => {
      const r = calcPurchaseLineGST(100, 0, 0, 5);
      expect(r.lineTotal).toBe(0);
      expect(r.totalGst).toBe(0);
      expect(r.amount).toBe(0);
    });
  });
});

describe("bill-level discount reduces the taxable value (s.15(3) CGST Act)", () => {
  const line = { mrp: 1000, quantity: 1, discount: 0, gstRate: 12 };

  it("scales taxable and GST, not just the total", () => {
    const full = calcInvoiceTotals([line], false);
    const discounted = calcInvoiceTotals([line], false, 10);

    // Deducting the discount after the tax left these two identical, so the pharmacy
    // remitted GST on Rs.100 it never collected.
    expect(discounted.taxableAmount).toBeLessThan(full.taxableAmount);
    expect(discounted.totalGst).toBeLessThan(full.totalGst);
    // Within a paisa: intra-state rounds the HALF (CGST must equal SGST), so the
    // total can legitimately land 0.01 off the gross — see
    // intraStateMayDifferByOnePaisaBecauseCgstMustEqualSgst above.
    expect(discounted.totalAmount).toBeCloseTo(full.totalAmount * 0.9, 1);
  });

  it("the invoice total is the discounted price paid", () => {
    // 1000 less 10% = 900.00, GST-inclusive.
    const t = calcInvoiceTotals([line], false, 10);
    expect(t.totalAmount).toBe(900);
    // taxable + tax reconciles to within a paisa (equal CGST/SGST split).
    expect(Math.abs(t.taxableAmount + t.totalGst - t.totalAmount)).toBeLessThanOrEqual(0.01 + 1e-9);
  });

  it("reports line and bill discounts as one figure", () => {
    // 10% off the line, then 5% off the bill: 1000 -> 900 -> 855.
    const t = calcInvoiceTotals([{ ...line, discount: 10 }], false, 5);
    expect(t.discountAmount).toBeCloseTo(145, 2);
    expect(t.totalAmount).toBeCloseTo(855, 1); // paisa tolerance, as above
  });

  it("compounds with the line discount rather than adding to it", () => {
    // 0.90 x 0.95 = 0.855, not 1 - 0.15.
    const compounded = calcInvoiceTotals([{ ...line, discount: 10 }], false, 5);
    const added = calcInvoiceTotals([{ ...line, discount: 15 }], false, 0);
    expect(compounded.totalAmount).toBeCloseTo(855, 1);
    expect(added.totalAmount).toBeCloseTo(850, 1);
    // The point of the test: compounding and adding are genuinely different amounts.
    expect(compounded.totalAmount).toBeGreaterThan(added.totalAmount);
  });

  it("holds for interstate invoices too", () => {
    const t = calcInvoiceTotals([line], true, 10);
    expect(t.cgst).toBe(0);
    expect(t.sgst).toBe(0);
    expect(t.igst).toBeGreaterThan(0);
    expect(Math.abs(t.taxableAmount + t.igst - t.totalAmount)).toBeLessThanOrEqual(0.01 + 1e-9);
  });

  it("zero and absent behave identically", () => {
    expect(calcInvoiceTotals([line], false, 0)).toEqual(calcInvoiceTotals([line], false));
  });

  it("a 100% bill discount zeroes the tax as well as the total", () => {
    const t = calcInvoiceTotals([line], false, 100);
    expect(t.totalAmount).toBe(0);
    expect(t.totalGst).toBe(0);
    expect(t.taxableAmount).toBe(0);
  });
});
