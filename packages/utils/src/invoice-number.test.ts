import { describe, it, expect } from "vitest";
import { getFinancialYear, generateInvoiceNumber } from "./invoice-number.js";

// ── getFinancialYear ──────────────────────────────────────────────────────────
// Indian FY: April 1 → March 31
// FY 2025-26 runs from 1 Apr 2025 to 31 Mar 2026

describe("getFinancialYear", () => {
  it("April 1 is the first day of a new FY", () => {
    expect(getFinancialYear(new Date(2025, 3, 1))).toBe("25-26"); // Month is 0-indexed: 3 = April
  });

  it("March 31 is still the previous FY", () => {
    expect(getFinancialYear(new Date(2025, 2, 31))).toBe("24-25"); // 2 = March
  });

  it("mid-year (October) is correctly classified", () => {
    expect(getFinancialYear(new Date(2025, 9, 15))).toBe("25-26"); // 9 = October
  });

  it("January is in the same FY as the previous April", () => {
    expect(getFinancialYear(new Date(2026, 0, 1))).toBe("25-26"); // 0 = January
  });

  it("year boundary — Dec 31 vs Jan 1", () => {
    expect(getFinancialYear(new Date(2025, 11, 31))).toBe("25-26"); // Dec 31 2025
    expect(getFinancialYear(new Date(2026, 0, 1))).toBe("25-26");  // Jan 1 2026 — same FY
  });

  it("returns two-digit years separated by hyphen", () => {
    const fy = getFinancialYear(new Date(2025, 4, 1));
    expect(fy).toMatch(/^\d{2}-\d{2}$/);
  });

  it("consecutive FYs differ by one year", () => {
    const fy1 = getFinancialYear(new Date(2024, 3, 1)); // Apr 2024 → "24-25"
    const fy2 = getFinancialYear(new Date(2025, 3, 1)); // Apr 2025 → "25-26"
    const [start1] = fy1.split("-").map(Number);
    const [start2] = fy2.split("-").map(Number);
    expect(start2 - start1).toBe(1);
  });

  it("uses current date when no argument is passed", () => {
    // Just verifies it returns a valid FY string without throwing
    const result = getFinancialYear();
    expect(result).toMatch(/^\d{2}-\d{2}$/);
  });
});

// ── generateInvoiceNumber ─────────────────────────────────────────────────────

describe("generateInvoiceNumber", () => {
  const aprilDate = new Date(2025, 3, 1); // FY 25-26

  describe("with financial year", () => {
    it("produces format PREFIX/FY/SEQUENCE", () => {
      expect(generateInvoiceNumber("INV", 1, true, aprilDate)).toBe("INV/25-26/000001");
    });

    it("sequence 1 is padded to 6 digits by default", () => {
      expect(generateInvoiceNumber("INV", 1, true, aprilDate)).toMatch(/000001$/);
    });

    it("sequence 999999 fills all 6 digits without truncation", () => {
      expect(generateInvoiceNumber("INV", 999999, true, aprilDate)).toBe("INV/25-26/999999");
    });

    it("sequence beyond counter length is not truncated", () => {
      expect(generateInvoiceNumber("INV", 1000000, true, aprilDate)).toBe("INV/25-26/1000000");
    });

    it("different prefixes produce distinct invoice numbers", () => {
      const a = generateInvoiceNumber("INV", 1, true, aprilDate);
      const b = generateInvoiceNumber("PUR", 1, true, aprilDate);
      expect(a).not.toBe(b);
      expect(a.startsWith("INV")).toBe(true);
      expect(b.startsWith("PUR")).toBe(true);
    });

    it("FY changes on April 1", () => {
      const march = generateInvoiceNumber("INV", 1, true, new Date(2025, 2, 31)); // "24-25"
      const april = generateInvoiceNumber("INV", 1, true, new Date(2025, 3, 1));  // "25-26"
      expect(march).toContain("24-25");
      expect(april).toContain("25-26");
    });
  });

  describe("without financial year", () => {
    it("produces format PREFIX/SEQUENCE", () => {
      expect(generateInvoiceNumber("INV", 1, false, aprilDate)).toBe("INV/000001");
    });

    it("has no FY segment", () => {
      const result = generateInvoiceNumber("INV", 42, false, aprilDate);
      expect(result.split("/")).toHaveLength(2);
    });

    it("sequence padding still applies", () => {
      expect(generateInvoiceNumber("INV", 7, false, aprilDate)).toBe("INV/000007");
    });
  });

  describe("custom separator", () => {
    it("uses custom separator between segments", () => {
      expect(generateInvoiceNumber("INV", 1, true, aprilDate, "-")).toBe("INV-25-26-000001");
    });

    it("no separator produces concatenated string", () => {
      expect(generateInvoiceNumber("INV", 1, false, aprilDate, "")).toBe("INV000001");
    });
  });

  describe("custom counter length", () => {
    it("pads to specified counter length", () => {
      expect(generateInvoiceNumber("INV", 1, false, aprilDate, "/", 4)).toBe("INV/0001");
    });

    it("counter length of 8", () => {
      expect(generateInvoiceNumber("INV", 1, false, aprilDate, "/", 8)).toBe("INV/00000001");
    });
  });

  describe("sequential uniqueness", () => {
    it("consecutive sequences never collide", () => {
      const numbers = Array.from({ length: 100 }, (_, i) =>
        generateInvoiceNumber("INV", i + 1, true, aprilDate),
      );
      const unique = new Set(numbers);
      expect(unique.size).toBe(100);
    });
  });
});
