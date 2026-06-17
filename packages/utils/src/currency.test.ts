import { describe, it, expect } from "vitest";
import { formatCurrency, formatAmountInWords } from "./currency.js";

// ── formatCurrency ────────────────────────────────────────────────────────────

describe("formatCurrency", () => {
  it("formats zero with two decimal places", () => {
    expect(formatCurrency(0)).toBe("₹0.00");
  });

  it("formats a whole rupee amount", () => {
    expect(formatCurrency(100)).toBe("₹100.00");
  });

  it("formats paise correctly", () => {
    expect(formatCurrency(100.5)).toBe("₹100.50");
  });

  it("formats amount with two paise digits", () => {
    expect(formatCurrency(1234.56)).toBe("₹1,234.56");
  });

  it("uses Indian number grouping (lakhs)", () => {
    // en-IN: 1,00,000 not 100,000
    expect(formatCurrency(100000)).toBe("₹1,00,000.00");
  });

  it("uses Indian number grouping (crores)", () => {
    expect(formatCurrency(10000000)).toBe("₹1,00,00,000.00");
  });

  it("accepts a custom currency symbol", () => {
    expect(formatCurrency(500, "$")).toBe("$500.00");
  });

  it("rounds to exactly two decimal places", () => {
    // Should not show more than 2 decimal places
    expect(formatCurrency(1.005)).toMatch(/^₹1\.0[01]$/); // rounding edge — just verify 2dp
    const result = formatCurrency(99.999);
    expect(result.split(".")[1]).toHaveLength(2);
  });
});

// ── formatAmountInWords ───────────────────────────────────────────────────────

describe("formatAmountInWords", () => {
  it("zero → Zero Rupees Only", () => {
    expect(formatAmountInWords(0)).toBe("Zero Rupees Only");
  });

  it("single digit", () => {
    expect(formatAmountInWords(1)).toBe("One Rupees Only");
    expect(formatAmountInWords(9)).toBe("Nine Rupees Only");
  });

  it("teens (11-19)", () => {
    expect(formatAmountInWords(11)).toBe("Eleven Rupees Only");
    expect(formatAmountInWords(15)).toBe("Fifteen Rupees Only");
    expect(formatAmountInWords(19)).toBe("Nineteen Rupees Only");
  });

  it("tens", () => {
    expect(formatAmountInWords(20)).toBe("Twenty Rupees Only");
    expect(formatAmountInWords(90)).toBe("Ninety Rupees Only");
  });

  it("hundreds", () => {
    expect(formatAmountInWords(100)).toBe("One Hundred Rupees Only");
    expect(formatAmountInWords(500)).toBe("Five Hundred Rupees Only");
  });

  it("thousands", () => {
    expect(formatAmountInWords(1000)).toBe("One Thousand Rupees Only");
    expect(formatAmountInWords(5000)).toBe("Five Thousand Rupees Only");
  });

  it("lakhs (Indian numbering)", () => {
    expect(formatAmountInWords(100000)).toBe("One Lakh Rupees Only");
    expect(formatAmountInWords(500000)).toBe("Five Lakh Rupees Only");
  });

  it("crores", () => {
    expect(formatAmountInWords(10000000)).toBe("One Crore Rupees Only");
  });

  it("compound amount with paise", () => {
    expect(formatAmountInWords(100.5)).toBe("One Hundred Rupees and Fifty Paise Only");
  });

  it("paise only (less than one rupee)", () => {
    expect(formatAmountInWords(0.25)).toBe("Zero Rupees and Twenty Five Paise Only");
  });

  it("typical invoice amount — no paise", () => {
    expect(formatAmountInWords(1234)).toContain("Rupees Only");
    expect(formatAmountInWords(1234)).not.toContain("Paise");
  });

  it("typical invoice amount — with paise", () => {
    const result = formatAmountInWords(1234.56);
    expect(result).toContain("Rupees and");
    expect(result).toContain("Paise Only");
  });

  it("output always ends with Only", () => {
    [0, 1, 100, 1000, 100000, 10000000, 50.75].forEach((n) => {
      expect(formatAmountInWords(n)).toMatch(/Only$/);
    });
  });
});
