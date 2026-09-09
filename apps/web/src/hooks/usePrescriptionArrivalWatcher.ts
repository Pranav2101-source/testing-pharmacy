import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePrescriptionNewCount } from "@/lib/prescriptionNewCount";
import { getStoredUser } from "@/lib/auth";
import { useToast } from "@/hooks/useToast";
import { playArrivalChime } from "@/lib/notifySound";
import {
  reconcileArrivalCount,
  arrivalCountToastMessage,
  loadBaseline,
  saveBaseline,
  type ArrivalAlertState,
} from "@/lib/prescriptionArrivalAlert";

/**
 * App-wide watcher for clinic-sourced prescriptions arriving. Mounted once in the
 * dashboard shell so the chime + toast fire on ANY screen — previously they lived
 * only on the Prescriptions page, so a pharmacist working the billing counter got
 * nothing but a silent nav badge when a clinic pushed an Rx.
 *
 * Mechanics:
 *  - Rides the SHARED `usePrescriptionNewCount` query (same key the nav badge uses),
 *    so this adds no extra requests — react-query dedupes to one poll every 30s,
 *    and only while the tab is on screen. `refetchOnWindowFocus` gives an immediate
 *    reconcile the moment a backgrounded tab comes back, so a batch that arrived
 *    while it was hidden announces once on return rather than being missed.
 *  - The count is absolute server truth, so a failed poll / reconnect / sleep can
 *    never desync us: on `isError` we simply don't touch the baseline, and the next
 *    good reading reconciles the full delta.
 *  - Baseline is persisted per-tab (sessionStorage) so a mid-shift reload does not
 *    re-announce what was already waiting. See prescriptionArrivalAlert.ts.
 */
export function usePrescriptionArrivalWatcher(): void {
  const { data: count, isSuccess } = usePrescriptionNewCount();
  const toast = useToast();
  const qc = useQueryClient();

  const pharmacyId = getStoredUser()?.pharmacyId ?? null;
  const stateRef = useRef<ArrivalAlertState>({ baseline: null });

  // Seed (and reset on pharmacy switch) the in-memory baseline from this tab's
  // persisted value. Defined before the reconcile effect so that on a commit where
  // pharmacyId changed, this runs first and the reconcile below compares against
  // the freshly-seeded baseline.
  useEffect(() => {
    stateRef.current = { baseline: pharmacyId ? loadBaseline(pharmacyId) : null };
  }, [pharmacyId]);

  useEffect(() => {
    if (!pharmacyId || !isSuccess || typeof count !== "number") return;

    const { nextState, toAnnounce } = reconcileArrivalCount(stateRef.current, count);
    stateRef.current = nextState;
    saveBaseline(pharmacyId, nextState.baseline ?? 0);

    if (toAnnounce > 0) {
      toast.info(arrivalCountToastMessage(toAnnounce));
      playArrivalChime();
      // The Prescriptions list polls slowly now (20s). If the pharmacist happens to
      // be looking at it, refresh so the new rows and their "New" pills land with
      // the chime instead of up to 20s later.
      void qc.invalidateQueries({ queryKey: ["prescriptions"] });
    }
  }, [pharmacyId, isSuccess, count, toast, qc]);
}
