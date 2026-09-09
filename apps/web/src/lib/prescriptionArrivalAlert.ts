/**
 * Deciding whether a fresh reading of the "new clinic prescriptions" count is worth
 * interrupting a pharmacist for — the logic behind the app-wide arrival chime + toast.
 *
 * This is deliberately a COUNT reconciler, not an event stream consumer. The server
 * number (`Prescription.viewedAt IS NULL` for clinic-sourced rows) is absolute truth,
 * so every poll fully reconciles: a dropped request, a slept laptop, a backgrounded
 * tab or a missed webhook can never leave us permanently out of sync the way a
 * fire-and-forget "new arrival" event could. The cost is that we only know a delta,
 * not which patients — so the toast copy counts rather than names.
 *
 * Pulled out of the hook so the one thing that actually decides "chime / stay silent"
 * is a pure function with no timers, no react-query and no AudioContext to stub.
 */

export type ArrivalAlertState = {
  /**
   * The count value already accounted for — either announced, or silently accepted
   * as the baseline. `null` means we have not observed the count yet this session.
   */
  baseline: number | null;
};

export type ArrivalAlertDecision = {
  nextState: ArrivalAlertState;
  /** How many newly-arrived prescriptions to announce now. 0 = stay silent. */
  toAnnounce: number;
};

/**
 * @param state the previous baseline (carry `nextState` forward between calls).
 * @param count the count the server just reported.
 */
export function reconcileArrivalCount(
  state: ArrivalAlertState,
  count: number,
): ArrivalAlertDecision {
  // A garbage reading (NaN, negative, non-integer) tells us nothing — hold the
  // baseline exactly where it was and stay silent rather than announce noise.
  if (!Number.isFinite(count) || count < 0) {
    return { nextState: state, toAnnounce: 0 };
  }
  const seen = Math.floor(count);

  // First observation this session is never "news" — whatever is already waiting
  // was waiting before the pharmacist opened this tab. It only sets the baseline.
  if (state.baseline === null) {
    return { nextState: { baseline: seen }, toAnnounce: 0 };
  }

  // Count went down (rows were opened / marked viewed) or held steady — move the
  // baseline so a later genuine arrival is measured from here, but say nothing.
  if (seen <= state.baseline) {
    return { nextState: { baseline: seen }, toAnnounce: 0 };
  }

  // Count rose — announce the delta and advance the baseline so the next identical
  // poll does not repeat it.
  return { nextState: { baseline: seen }, toAnnounce: seen - state.baseline };
}

/** Toast copy for a batch of arrivals — singular reads naturally, plural just counts. */
export function arrivalCountToastMessage(count: number): string {
  return count === 1
    ? "New prescription arrived from a clinic"
    : `${count} new prescriptions arrived from clinics`;
}

// ─── Per-tab baseline persistence ─────────────────────────────────────────────
// sessionStorage, not localStorage, and that is the point: a reload mid-shift must
// NOT re-announce prescriptions that were already waiting before the refresh, but a
// genuinely new browser session (next morning, a fresh tab) SHOULD re-baseline
// silently rather than trumpet everything that piled up overnight — the nav badge
// already carries that number. Keyed by pharmacy so switching login in the same
// tab starts clean instead of comparing against the previous pharmacy's count.

const BASELINE_KEY_PREFIX = "checkup_rx_arrival_baseline_v1:";

export function loadBaseline(pharmacyId: string): number | null {
  try {
    const raw = sessionStorage.getItem(BASELINE_KEY_PREFIX + pharmacyId);
    if (raw === null) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function saveBaseline(pharmacyId: string, baseline: number): void {
  try {
    sessionStorage.setItem(BASELINE_KEY_PREFIX + pharmacyId, String(Math.max(0, Math.floor(baseline))));
  } catch {
    // A full or unavailable sessionStorage just means a reload might re-announce
    // once — not worth surfacing.
  }
}
