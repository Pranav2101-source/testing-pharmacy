import { describe, expect, it } from "vitest";
import { arrivalToastMessage, detectNewArrivals } from "./prescriptionArrivals";

function rx(id: string, overrides: Partial<Parameters<typeof detectNewArrivals>[0][number]> = {}) {
  return {
    id, externalTenantId: "clinic-1", patientName: "Asha Verma", doctorName: "Rao",
    ...overrides,
  };
}

describe("detectNewArrivals", () => {
  it("the very first call is the baseline, not a stream of arrivals", () => {
    const result = detectNewArrivals([rx("a"), rx("b")], null);

    expect(result.isFirstLoad).toBe(true);
    expect(result.arrived).toEqual([]);
  });

  it("an id not in the seen set is a genuine arrival", () => {
    const seen = new Set(["a"]);
    const result = detectNewArrivals([rx("a"), rx("b")], seen);

    expect(result.isFirstLoad).toBe(false);
    expect(result.arrived.map((r) => r.id)).toEqual(["b"]);
  });

  it("a counter-written prescription (no externalTenantId) is never an arrival, even if unseen", () => {
    const seen = new Set<string>();
    const result = detectNewArrivals([rx("a", { externalTenantId: null })], seen);

    expect(result.arrived).toEqual([]);
  });

  it("nothing new means an empty arrival list, not an error", () => {
    const seen = new Set(["a", "b"]);
    const result = detectNewArrivals([rx("a"), rx("b")], seen);

    expect(result.arrived).toEqual([]);
  });

  it("multiple genuinely new rows all come back", () => {
    const seen = new Set(["a"]);
    const result = detectNewArrivals([rx("a"), rx("b"), rx("c")], seen);

    expect(result.arrived.map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("paging away and back does not resurrect an already-seen id as new", () => {
    // seen accumulates across pages in the real caller; this just proves the function
    // itself only ever looks at membership, never at "was this on the LAST page".
    const seen = new Set(["a", "b", "c"]);
    const result = detectNewArrivals([rx("a")], seen);

    expect(result.arrived).toEqual([]);
  });
});

describe("arrivalToastMessage", () => {
  it("names the patient and doctor for a single arrival", () => {
    const message = arrivalToastMessage([rx("a", { patientName: "Ravi Kumar", doctorName: "Mehta" })]);

    expect(message).toBe("New prescription for Ravi Kumar — Dr. Mehta");
  });

  it("just counts for more than one", () => {
    const message = arrivalToastMessage([rx("a"), rx("b"), rx("c")]);

    expect(message).toBe("3 new prescriptions arrived from clinics");
  });
});
