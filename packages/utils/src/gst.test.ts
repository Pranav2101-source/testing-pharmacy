import { describe, it, expect } from "vitest";
import { calcGstFromMrp, calcInvoiceTotals, calcPurchaseLineGST } from "./gst.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Every result must satisfy these two invariants regardless of inputs. */
function assertInvariants(r: ReturnType<typeof calcGstFromMrp>) {
  expect(r.cgst + r.sgst + r.igst).toBeCloseTo(r.totalGst, 10);
  expect(r.taxableAmount + r.totalGst).toBeCloseTo(r.totalAmount, 10);
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
      expect(r.taxableAmount + r.totalGst).toBe(r.totalAmount);
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
    expect(r.taxableAmount + r.totalGst).toBe(r.totalAmount);
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
