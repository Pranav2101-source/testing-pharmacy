import { describe, it, expect } from "vitest";
import {
  packSizeChip, needsPackSizeCheck, verifyPackSizeHref,
  type PackSizeConfidence,
} from "./packSizeConfidence";

describe("packSizeChip", () => {
  it("says nothing about a verified pack size", () => {
    // The affirmation is silence. A badge on the good state as well as the bad one just
    // doubles what is on the line without changing what anyone should do about it.
    expect(packSizeChip("VERIFIED")).toBeNull();
  });

  it("says nothing when the medicine has no pack size on record at all", () => {
    // Distinct from UNVERIFIED: nothing is classified, so there is nothing to distrust —
    // and flagging it would put a chip on every unclassified line in the catalogue.
    expect(packSizeChip(null)).toBeNull();
    expect(packSizeChip(undefined)).toBeNull();
  });

  it("flags an unverified pack size quietly — used, not blocked", () => {
    const chip = packSizeChip("UNVERIFIED");
    expect(chip?.label).toBe("Unverified pack size");
    expect(chip?.urgent).toBe(false);
    // Slate, not amber: this is true of most of a real catalogue.
    expect(chip?.className).toContain("slate");
    expect(chip?.title).toMatch(/still used for billing/i);
  });

  it("flags a disputed pack size loudly — this one is a contradiction", () => {
    const chip = packSizeChip("DISPUTED");
    expect(chip?.label).toBe("Pack size disputed");
    expect(chip?.urgent).toBe(true);
    expect(chip?.className).toContain("red");
  });
});

describe("needsPackSizeCheck", () => {
  it("is true only for the two states a human has to resolve", () => {
    const cases: [PackSizeConfidence | null | undefined, boolean][] = [
      ["UNVERIFIED", true],
      ["DISPUTED", true],
      ["VERIFIED", false],
      [null, false],
      [undefined, false],
    ];
    for (const [confidence, expected] of cases) {
      expect(needsPackSizeCheck(confidence)).toBe(expected);
    }
  });
});

describe("verifyPackSizeHref", () => {
  it("lands on the batches tab with the medicine already searched for", () => {
    const href = verifyPackSizeHref("med_1", "Melgain 5% Solution");
    expect(href.startsWith("/dashboard/inventory?")).toBe(true);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("tab")).toBe("batches");
    expect(params.get("verifyPackSize")).toBe("med_1");
    // Without the search term the deep link would open page one of every batch the
    // pharmacy holds, and the row it is meant to act on would not be among them.
    expect(params.get("search")).toBe("Melgain 5% Solution");
  });

  it("escapes a name that would otherwise break the query string", () => {
    const href = verifyPackSizeHref("med_2", "Vitamin A & D 100% w/v");
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("search")).toBe("Vitamin A & D 100% w/v");
  });
});
