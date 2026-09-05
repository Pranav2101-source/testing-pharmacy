import { describe, expect, it } from "vitest";
import { packDisplayLabel } from "./packSize";

/**
 * packDisplayLabel decides what the billing cart's PACK column shows — it never
 * touches the catalogue, and unitsPerPack itself is never changed by it (that stays
 * the structured source of truth the loose-selling math uses). This is purely about
 * what's legible to a cashier glancing at the cart.
 */
describe("packDisplayLabel", () => {
  it("uses a meaningful packSize as-is, regardless of unitsPerPack", () => {
    expect(packDisplayLabel("10 tablets", 10)).toBe("10 tablets");
    expect(packDisplayLabel("10 tablets", null)).toBe("10 tablets");
    expect(packDisplayLabel("1x15", 15)).toBe("1x15");
  });

  it("falls back to a computed label when packSize is a bare number and unitsPerPack is available", () => {
    expect(packDisplayLabel("1", 12)).toBe("12/strip");
    expect(packDisplayLabel("10", 10)).toBe("10/strip");
  });

  it("falls back to a computed label when packSize is empty and unitsPerPack is available", () => {
    expect(packDisplayLabel(null, 10)).toBe("10/strip");
    expect(packDisplayLabel(undefined, 10)).toBe("10/strip");
    expect(packDisplayLabel("", 10)).toBe("10/strip");
    expect(packDisplayLabel("   ", 10)).toBe("10/strip");
  });

  it("shows the bare number as-is when there is no unitsPerPack to fall back to", () => {
    expect(packDisplayLabel("1", null)).toBe("1");
    expect(packDisplayLabel("1", undefined)).toBe("1");
    expect(packDisplayLabel("1", 0)).toBe("1");
  });

  it("shows a placeholder dash when there is neither a packSize nor a unitsPerPack", () => {
    expect(packDisplayLabel(null, null)).toBe("—");
    expect(packDisplayLabel(undefined, undefined)).toBe("—");
    expect(packDisplayLabel("", null)).toBe("—");
  });
});
