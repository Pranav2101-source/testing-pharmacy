import { describe, it, expect } from "vitest";
import { resolveBaseUnit, saleUnitModel, titleCaseUnit, pluraliseUnit } from "./sale-unit.js";

describe("resolveBaseUnit", () => {
  it("prefers the stored base unit", () => {
    expect(resolveBaseUnit("ML", "tablet")).toBe("ML");
    expect(resolveBaseUnit("tablet", null)).toBe("TABLET");
  });

  it("infers from form when no base unit is stored — same rules as Java BaseUnits.resolve", () => {
    expect(resolveBaseUnit(null, "Tablet")).toBe("TABLET");
    expect(resolveBaseUnit(null, "capsule")).toBe("CAPSULE");
    expect(resolveBaseUnit(null, "syrup")).toBe("ML");
    expect(resolveBaseUnit(null, "Oral Suspension")).toBe("ML");
    expect(resolveBaseUnit(null, "eye drops")).toBe("ML");
    expect(resolveBaseUnit(null, "tonic")).toBe("ML");
    expect(resolveBaseUnit(null, "cream")).toBe("GM");
    expect(resolveBaseUnit(null, "ointment")).toBe("GM");
    expect(resolveBaseUnit(null, "injection")).toBe("EACH");
    expect(resolveBaseUnit(null, null)).toBe("EACH");
    expect(resolveBaseUnit("", "")).toBe("EACH");
  });
});

describe("saleUnitModel", () => {
  it("a plain tablet: strip / tab, not divisible without loose opt-in", () => {
    const m = saleUnitModel({ form: "tablet", unit: "Strip", unitsPerPack: 15, baseUnit: "TABLET" });
    expect(m.packUnitLabel).toBe("strip");
    expect(m.looseUnitShort).toBe("tab");
    expect(m.divisible).toBe(false);
    expect(m.classified).toBe(true);
    expect(m.measured).toBe(false);
  });

  it("a loose-enabled tablet is divisible", () => {
    const m = saleUnitModel({ form: "tablet", unitsPerPack: 15, baseUnit: "TABLET", allowLooseSale: true });
    expect(m.divisible).toBe(true);
  });

  it("Schedule X is never divisible even with loose on", () => {
    const m = saleUnitModel({ unitsPerPack: 10, baseUnit: "TABLET", allowLooseSale: true, schedule: "X" });
    expect(m.divisible).toBe(false);
  });

  it("a syrup: bottle / mL, measured", () => {
    const m = saleUnitModel({ form: "syrup", unit: "Bottle", unitsPerPack: 100, baseUnit: "ML" });
    expect(m.packUnitLabel).toBe("bottle");
    expect(m.looseUnitLabel).toBe("mL");
    expect(m.looseUnitShort).toBe("mL");
    expect(m.measured).toBe(true);
  });

  it("a cream: tube / g, measured", () => {
    const m = saleUnitModel({ form: "cream", baseUnit: "GM" });
    expect(m.packUnitLabel).toBe("tube");
    expect(m.looseUnitShort).toBe("g");
    expect(m.measured).toBe(true);
  });

  it("an unclassified syrup falls back to bottle, not classified, not divisible", () => {
    const m = saleUnitModel({ form: "syrup", packSize: "100ml" });
    expect(m.baseUnit).toBe("ML");
    expect(m.packUnitLabel).toBe("bottle");
    expect(m.classified).toBe(false);
    expect(m.divisible).toBe(false);
  });

  it("uses the packaging word when it's a known one", () => {
    expect(saleUnitModel({ unit: "Vial", baseUnit: "EACH" }).packUnitLabel).toBe("vial");
    expect(saleUnitModel({ unit: "Drops", baseUnit: "ML" }).packUnitLabel).toBe("bottle");
    expect(saleUnitModel({ unit: "Sachet", baseUnit: "GM" }).packUnitLabel).toBe("sachet");
  });

  it("ignores a size string in the packaging field and infers from base unit instead", () => {
    expect(saleUnitModel({ unit: "100ml", baseUnit: "ML" }).packUnitLabel).toBe("bottle");
  });

  it("unknown base unit → unit / u", () => {
    const m = saleUnitModel({ baseUnit: "EACH" });
    expect(m.packUnitLabel).toBe("unit");
    expect(m.looseUnitShort).toBe("u");
  });
});

describe("titleCaseUnit / pluraliseUnit", () => {
  it("title-cases a plain word, leaves mixed-case alone", () => {
    expect(titleCaseUnit("bottle")).toBe("Bottle");
    expect(titleCaseUnit("mL")).toBe("mL");
  });

  it("pluralises countable units, not measured ones", () => {
    expect(pluraliseUnit("bottle", 1)).toBe("bottle");
    expect(pluraliseUnit("bottle", 2)).toBe("bottles");
    expect(pluraliseUnit("mL", 2)).toBe("mL");
    expect(pluraliseUnit("g", 5)).toBe("g");
  });
});
