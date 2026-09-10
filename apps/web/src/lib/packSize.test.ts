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
    expect(packDisplayLabel("1", 12, "TABLET")).toBe("12/strip");
    expect(packDisplayLabel("10", 10, "TABLET")).toBe("10/strip");
  });

  it("falls back to a computed label when packSize is empty and unitsPerPack is available", () => {
    expect(packDisplayLabel(null, 10, "TABLET")).toBe("10/strip");
    expect(packDisplayLabel(undefined, 10, "TABLET")).toBe("10/strip");
    expect(packDisplayLabel("", 10, "TABLET")).toBe("10/strip");
    expect(packDisplayLabel("   ", 10, "TABLET")).toBe("10/strip");
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

  it("always prefers a meaningful catalogue packSize over the computed fallback, for any base unit", () => {
    expect(packDisplayLabel("100ml", 100, "ML")).toBe("100ml");
    expect(packDisplayLabel("100ml bottle", 100, "ML")).toBe("100ml bottle");
    expect(packDisplayLabel("15 tablets", 15, "TABLET")).toBe("15 tablets");
  });

  it("a measured medicine (ML/GM) with no usable packSize gets a volume/weight label, never '/strip'", () => {
    expect(packDisplayLabel(null, 100, "ML")).toBe("100ml");
    expect(packDisplayLabel(undefined, 60, "ml")).toBe("60ml");
    expect(packDisplayLabel("1", 100, "ML")).toBe("100ml"); // bare number demoted
    expect(packDisplayLabel(null, 30, "GM")).toBe("30g");
    expect(packDisplayLabel(null, 30, "gm")).toBe("30g");
  });

  it("a tablet or capsule gets the '/strip' fallback", () => {
    expect(packDisplayLabel(null, 15, "TABLET")).toBe("15/strip");
    expect(packDisplayLabel(null, 8, "CAPSULE")).toBe("8/strip");
  });

  it("names the medicine's OWN packaging word when the catalogue records one", () => {
    // The Melgain case: a bottle whose base unit nobody classified. Reading the packaging
    // word means the cart says "bottle" here exactly as the inventory screen already does,
    // instead of asserting a strip that does not exist.
    expect(packDisplayLabel(null, 10, null, "Bottle")).toBe("10/bottle");
    expect(packDisplayLabel(null, 10, "EACH", "Bottle")).toBe("10/bottle");
    expect(packDisplayLabel(null, 24, null, "Sachet")).toBe("24/sachet");
    // …and it still wins for a countable base unit whose packaging is unusual.
    expect(packDisplayLabel(null, 20, "TABLET", "Box")).toBe("20/box");
  });

  it("falls back to the neutral 'unit', never 'strip', when nothing classifies the medicine", () => {
    // "15/strip" here was a fabrication: an unclassified medicine has no recorded packaging
    // at all, and claiming a strip is what let a bottle read as one.
    expect(packDisplayLabel(null, 15, "EACH")).toBe("15/unit");
    expect(packDisplayLabel(null, 15)).toBe("15/unit");
    expect(packDisplayLabel(null, 15, null, null)).toBe("15/unit");
  });

  it("a measured medicine keeps its volume label even when a packaging word is present", () => {
    expect(packDisplayLabel(null, 100, "ML", "Bottle")).toBe("100ml");
    expect(packDisplayLabel(null, 30, "GM", "Tube")).toBe("30g");
  });
});
