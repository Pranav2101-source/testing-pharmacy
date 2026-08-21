/**
 * Deciding which prescriptions on a freshly-fetched page are ones nobody at this pharmacy
 * has seen yet — the logic behind the live "New" badge and toast on the Prescriptions page.
 *
 * Pulled out of PrescriptionsPage on purpose: that component is large and heavy to render
 * in a test (create/detail modals, clinic panels, forms), while the actual decision here —
 * what counts as "new" — is a handful of pure rules worth pinning down on their own.
 */

export type ArrivalCandidate = {
  id: string;
  /** Null for a counter-written prescription; the clinic's tenant id otherwise. */
  externalTenantId: string | null;
  patientName: string;
  doctorName: string;
};

export type ArrivalResult<T> = {
  /** Newly-seen, clinic-sourced items — what the caller should badge and toast about. */
  arrived: T[];
  /**
   * True only for the very first call with a given seenIds set. The first page a
   * pharmacist ever loads is not a stream of "arrivals" — it is just what already
   * existed. Nothing on it should badge or toast; it only establishes the baseline
   * a later, genuinely new row gets compared against.
   */
  isFirstLoad: boolean;
};

/**
 * @param items   the current page's rows, in whatever order the API returned them.
 * @param seenIds ids this screen has already shown at least once, or null on the very
 *                first call. Callers own this set and are expected to union `items`'
 *                ids into it after each call — this function only reads it.
 */
export function detectNewArrivals<T extends ArrivalCandidate>(
  items: T[],
  seenIds: Set<string> | null,
): ArrivalResult<T> {
  if (seenIds === null) {
    return { arrived: [], isFirstLoad: true };
  }
  // Only a clinic-sourced row counts as an "arrival" — a prescription a pharmacist just
  // typed in at the counter is not news to the person looking straight at it, and every
  // row they type would otherwise badge and toast itself.
  const arrived = items.filter((item) => item.externalTenantId !== null && !seenIds.has(item.id));
  return { arrived, isFirstLoad: false };
}

/** The toast copy for a batch of arrivals — singular names the patient, plural just counts. */
export function arrivalToastMessage(arrived: ArrivalCandidate[]): string {
  const only = arrived.length === 1 ? arrived[0] : undefined;
  if (only) {
    return `New prescription for ${only.patientName} — Dr. ${only.doctorName}`;
  }
  return `${arrived.length} new prescriptions arrived from clinics`;
}
