import { describe, expect, it } from "vitest";
import { computeNetPayable, shortfallMessage } from "./billTotals";

/**
 * The figure on the bill screen and the figure the backend accepts must be the
 * same number. These tests pin the arithmetic and, more importantly, pin the
 * refusal: a bill whose adjustments exceed its goods has to be visibly wrong on
 * screen, not silently shown as ₹0.00.
 */

const base = { itemsTotal: 0, billDiscountPct: 0, extraCharges: 0, adjustmentAmount: 0 };

describe("computeNetPayable", () => {
  describe("everyday arithmetic", () => {
    it("returns the item total untouched when there are no adjustments", () => {
      const r = computeNetPayable({ ...base, itemsTotal: 250 });
      expect(r.preRound).toBe(250);
      expect(r.netPayable).toBe(250);
      expect(r.shortfall).toBe(0);
    });

    it("applies a bill-level discount percentage", () => {
      const r = computeNetPayable({ ...base, itemsTotal: 1000, billDiscountPct: 10 });
      expect(r.preRound).toBeCloseTo(900, 2);
      expect(r.netPayable).toBe(900);
    });

    it("adds extra charges (delivery, packaging)", () => {
      const r = computeNetPayable({ ...base, itemsTotal: 500, extraCharges: 40 });
      expect(r.netPayable).toBe(540);
    });

    it("applies a negative adjustment as goodwill off the bill", () => {
      const r = computeNetPayable({ ...base, itemsTotal: 500, adjustmentAmount: -50 });
      expect(r.netPayable).toBe(450);
      expect(r.shortfall).toBe(0);
    });

    it("applies a positive adjustment as a surcharge", () => {
      const r = computeNetPayable({ ...base, itemsTotal: 500, adjustmentAmount: 25 });
      expect(r.netPayable).toBe(525);
    });

    it("combines discount, charges and adjustment in the backend's order", () => {
      // itemsTotal 1000 − 10% (100) + 50 − 20 = 930
      const r = computeNetPayable({
        itemsTotal: 1000, billDiscountPct: 10, extraCharges: 50, adjustmentAmount: -20,
      });
      expect(r.preRound).toBeCloseTo(930, 2);
      expect(r.netPayable).toBe(930);
    });
  });

  describe("rupee rounding — Indian retail convention", () => {
    it("rounds a paise total up to the nearest rupee", () => {
      const r = computeNetPayable({ ...base, itemsTotal: 249.6 });
      expect(r.netPayable).toBe(250);
      expect(r.roundOff).toBeCloseTo(0.4, 2);
    });

    it("rounds down when below the half-rupee", () => {
      const r = computeNetPayable({ ...base, itemsTotal: 249.2 });
      expect(r.netPayable).toBe(249);
      expect(r.roundOff).toBeCloseTo(-0.2, 2);
    });

    it("leaves a whole rupee alone with no round-off", () => {
      const r = computeNetPayable({ ...base, itemsTotal: 300 });
      expect(r.roundOff).toBe(0);
      expect(r.netPayable).toBe(300);
    });

    it("always yields a whole-rupee payable", () => {
      for (const itemsTotal of [1.01, 33.33, 99.99, 1234.56, 7.5]) {
        const { netPayable } = computeNetPayable({ ...base, itemsTotal });
        expect(Number.isInteger(Math.round(netPayable))).toBe(true);
        expect(netPayable).toBeCloseTo(Math.round(netPayable), 6);
      }
    });
  });

  describe("zero is legitimate, negative is not", () => {
    it("allows an exactly-zero bill (100% discount / free-of-charge dispensing)", () => {
      const r = computeNetPayable({ ...base, itemsTotal: 500, billDiscountPct: 100 });
      expect(r.netPayable).toBe(0);
      expect(r.shortfall).toBe(0);
    });

    it("allows a zero bill reached via an exactly-offsetting adjustment", () => {
      const r = computeNetPayable({ ...base, itemsTotal: 200, adjustmentAmount: -200 });
      expect(r.netPayable).toBe(0);
      expect(r.shortfall).toBe(0);
    });

    /**
     * The regression this module exists for.
     *
     * Both call sites used to clamp with Math.max(0, …), so a −₹500 adjustment on a
     * ₹200 bill displayed a confident ₹0.00 — indistinguishable from a legitimate
     * free-of-charge sale — and only failed on save with a 422 quoting figures the
     * cashier had never been shown.
     */
    it("reports a shortfall instead of clamping a negative bill to zero", () => {
      const r = computeNetPayable({ ...base, itemsTotal: 200, adjustmentAmount: -500 });
      expect(r.preRound).toBe(-300);
      expect(r.shortfall).toBe(300);
      expect(r.netPayable).not.toBe(0);
    });

    it("reports a shortfall when a bill discount over-runs the goods", () => {
      // 100 − 150% of 100 = −50
      const r = computeNetPayable({ ...base, itemsTotal: 100, billDiscountPct: 150 });
      expect(r.shortfall).toBeCloseTo(50, 2);
    });

    it("counts extra charges against the shortfall — they reduce it", () => {
      // 200 − 500 + 400 = +100, a valid bill
      const r = computeNetPayable({
        ...base, itemsTotal: 200, adjustmentAmount: -500, extraCharges: 400,
      });
      expect(r.shortfall).toBe(0);
      expect(r.netPayable).toBe(100);
    });

    it("flags an empty cart carrying a negative adjustment", () => {
      const r = computeNetPayable({ ...base, itemsTotal: 0, adjustmentAmount: -10 });
      expect(r.shortfall).toBe(10);
    });

    it("does not flag an empty cart with no adjustments", () => {
      expect(computeNetPayable(base).shortfall).toBe(0);
      expect(computeNetPayable(base).netPayable).toBe(0);
    });
  });

  describe("shortfallMessage", () => {
    it("names the amount and the fields to check", () => {
      const msg = shortfallMessage(300);
      expect(msg).toContain("₹300.00");
      expect(msg).toMatch(/bill discount/i);
      expect(msg).toMatch(/adjustment/i);
    });

    it("mirrors the backend's wording so the two cannot contradict", () => {
      // Backend: "Discounts and adjustments exceed the value of this bill by Rs.X."
      expect(shortfallMessage(12.5)).toMatch(/^Discounts and adjustments exceed the value of this bill by /);
    });

    it("shows paise", () => {
      expect(shortfallMessage(12.5)).toContain("₹12.50");
    });
  });
});
