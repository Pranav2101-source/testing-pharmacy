import { describe, expect, it } from "vitest";
import { formatMeasuredAmount, measuredRxOvershoot, formatConversion } from "./measuredUnits";

describe("formatMeasuredAmount", () => {
  it("renders sealed-pack count with the clinical volume in brackets", () => {
    expect(formatMeasuredAmount(500, "ML", 100)).toBe("5 bottles (500 ml)");
    expect(formatMeasuredAmount(100, "ML", 100)).toBe("1 bottle (100 ml)");
    expect(formatMeasuredAmount(60, "GM", 30)).toBe("2 tubes (60 g)");
  });

  it("falls back to a bare volume when the pack size is unknown", () => {
    expect(formatMeasuredAmount(150, "ML", null)).toBe("150 ml");
  });
});

describe("measuredRxOvershoot — internal-note microtext numbers", () => {
  it("gives the prescribed volume and how far whole packs overshoot it", () => {
    const got = measuredRxOvershoot({
      prescribedVolumeClinical: 105,
      clinicalUom: "ML",
      quantity: 2,          // 2 sealed bottles on the cart line
      roundedPackCount: 2,
      unitsPerPack: 100,    // 100 ml a bottle
    });
    expect(got).toEqual({ prescribed: 105, excess: 95, unit: "ml" });
  });

  it("uses the cart quantity when roundedPackCount is absent", () => {
    const got = measuredRxOvershoot({
      prescribedVolumeClinical: 40, clinicalUom: "GM", quantity: 1, unitsPerPack: 30,
    });
    expect(got).toEqual({ prescribed: 40, excess: 0, unit: "g" });
  });

  it("is null for a non-measured or unresolved line", () => {
    expect(measuredRxOvershoot({ prescribedVolumeClinical: 105, clinicalUom: null, quantity: 2, unitsPerPack: 100 })).toBeNull();
    expect(measuredRxOvershoot({ clinicalUom: "ML", quantity: 2, unitsPerPack: 100 })).toBeNull();
    expect(measuredRxOvershoot({ prescribedVolumeClinical: 105, clinicalUom: "ML", quantity: 0, unitsPerPack: 0 })).toBeNull();
  });
});

describe("formatConversion — the arithmetic, spelled out on every measured line", () => {
  it("names the divisor next to the answer it produced", () => {
    // The reported bug: a 40 ml course against a wrong 5 ml pack size. Rendering this is
    // what puts the bad number where a pharmacist who has held the bottle can catch it.
    expect(formatConversion(40, 5, "ML", "bottle")).toBe("40 ml ÷ 5 ml/bottle → 8 bottles");
    // The same course against the real bottle.
    expect(formatConversion(40, 60, "ML", "bottle")).toBe("40 ml ÷ 60 ml/bottle → 1 bottle");
  });

  it("rounds up to whole sealed packs — a bottle can't be split", () => {
    expect(formatConversion(105, 100, "ML", "bottle")).toBe("105 ml ÷ 100 ml/bottle → 2 bottles");
    expect(formatConversion(45, 20, "GM", "tube")).toBe("45 g ÷ 20 g/tube → 3 tubes");
  });

  it("renders nothing when there is no honest divisor", () => {
    expect(formatConversion(40, 0, "ML", "bottle")).toBeNull();
    expect(formatConversion(0, 5, "ML", "bottle")).toBeNull();
  });
});
