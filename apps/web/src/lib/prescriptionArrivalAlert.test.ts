import { describe, expect, it, beforeEach } from "vitest";
import {
  reconcileArrivalCount,
  arrivalCountToastMessage,
  loadBaseline,
  saveBaseline,
  type ArrivalAlertState,
} from "./prescriptionArrivalAlert";

/**
 * The contract: a pharmacist is interrupted ONLY when the number of unseen
 * clinic prescriptions genuinely goes up, and never twice for the same one.
 * Everything below is a way that could go wrong.
 */
describe("reconcileArrivalCount", () => {
  const fresh: ArrivalAlertState = { baseline: null };

  it("the first reading is a silent baseline, not an arrival", () => {
    const { nextState, toAnnounce } = reconcileArrivalCount(fresh, 4);

    expect(toAnnounce).toBe(0);
    expect(nextState.baseline).toBe(4);
  });

  it("a rise announces exactly the delta", () => {
    const { nextState, toAnnounce } = reconcileArrivalCount({ baseline: 2 }, 5);

    expect(toAnnounce).toBe(3);
    expect(nextState.baseline).toBe(5);
  });

  it("an unchanged count stays silent", () => {
    expect(reconcileArrivalCount({ baseline: 5 }, 5).toAnnounce).toBe(0);
  });

  it("a drop (rows were opened) re-baselines downward, silently", () => {
    const { nextState, toAnnounce } = reconcileArrivalCount({ baseline: 5 }, 2);

    expect(toAnnounce).toBe(0);
    expect(nextState.baseline).toBe(2);
  });

  it("a rise AFTER a drop is measured from the lowered baseline, not the old peak", () => {
    const state = reconcileArrivalCount({ baseline: 5 }, 1).nextState; // opened 4
    const decision = reconcileArrivalCount(state, 2); // one new arrives

    expect(decision.toAnnounce).toBe(1);
  });

  it("does not repeat an announcement on the next identical poll", () => {
    const afterRise = reconcileArrivalCount({ baseline: 0 }, 3);
    expect(afterRise.toAnnounce).toBe(3);

    const nextPoll = reconcileArrivalCount(afterRise.nextState, 3);
    expect(nextPoll.toAnnounce).toBe(0);
  });

  it("0 -> N within a session is real news (baseline 0 is not the same as no baseline)", () => {
    expect(reconcileArrivalCount({ baseline: 0 }, 2).toAnnounce).toBe(2);
  });

  it("a garbage reading holds the baseline and stays silent", () => {
    for (const bad of [Number.NaN, -1, Infinity]) {
      const { nextState, toAnnounce } = reconcileArrivalCount({ baseline: 3 }, bad);
      expect(toAnnounce).toBe(0);
      expect(nextState.baseline).toBe(3);
    }
  });
});

describe("arrivalCountToastMessage", () => {
  it("reads naturally for one", () => {
    expect(arrivalCountToastMessage(1)).toBe("New prescription arrived from a clinic");
  });

  it("counts for more than one", () => {
    expect(arrivalCountToastMessage(3)).toBe("3 new prescriptions arrived from clinics");
  });
});

describe("per-tab baseline persistence", () => {
  beforeEach(() => sessionStorage.clear());

  it("round-trips a value, scoped to the pharmacy", () => {
    saveBaseline("ph_1", 7);
    expect(loadBaseline("ph_1")).toBe(7);
    expect(loadBaseline("ph_2")).toBeNull();
  });

  it("returns null when nothing has been stored (a fresh session re-baselines silently)", () => {
    expect(loadBaseline("ph_1")).toBeNull();
  });

  it("survives a corrupt stored value", () => {
    sessionStorage.setItem("checkup_rx_arrival_baseline_v1:ph_1", "not-a-number");
    expect(loadBaseline("ph_1")).toBeNull();
  });

  it("clamps a negative save to 0 rather than persisting nonsense", () => {
    saveBaseline("ph_1", -4);
    expect(loadBaseline("ph_1")).toBe(0);
  });
});
