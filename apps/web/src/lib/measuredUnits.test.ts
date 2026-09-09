import { describe, expect, it } from "vitest";
import { formatMeasuredAmount, measuredRxOvershoot } from "./measuredUnits";

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
