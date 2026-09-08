import { describe, expect, it } from "vitest";
import { packDisplayLabel, parseMeasuredPackSize } from "./packSize";

describe("parseMeasuredPackSize", () => {
  it("reads a volume/weight out of the pack-size text", () => {
    expect(parseMeasuredPackSize("100ml")).toBe(100);
    expect(parseMeasuredPackSize("100 ml")).toBe(100);
    expect(parseMeasuredPackSize("60 mL bottle")).toBe(60);
    expect(parseMeasuredPackSize("1 x 100ml")).toBe(100);
    expect(parseMeasuredPackSize("15g")).toBe(15);
    expect(parseMeasuredPackSize("20 gm tube")).toBe(20);
  });

  it("never mistakes a strength for a pack size", () => {
    expect(parseMeasuredPackSize("500mg")).toBeUndefined();
    expect(parseMeasuredPackSize("650 mg")).toBeUndefined();
    expect(parseMeasuredPackSize("5mcg")).toBeUndefined();
  });

  it("returns nothing for a countable pack size or junk", () => {
    expect(parseMeasuredPackSize("15 tablets")).toBeUndefined();
    expect(parseMeasuredPackSize("10x15")).toBeUndefined();
    expect(parseMeasuredPackSize(null)).toBeUndefined();
    expect(parseMeasuredPackSize("")).toBeUndefined();
    expect(parseMeasuredPackSize("1ml")).toBeUndefined(); // below the sane floor
  });
});

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
