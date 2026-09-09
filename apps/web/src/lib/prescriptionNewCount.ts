/**
 * The nav badge's count of clinic-sourced prescriptions nobody at this pharmacy has
 * opened yet. Backed by `Prescription.viewedAt` on the server — unlike the in-page
 * "New" row pill (see prescriptionArrivals.ts), this survives navigation and refresh
 * because it's a real column, not an in-memory Set that resets when a component unmounts.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export const PRESCRIPTION_NEW_COUNT_KEY = ["prescriptions-new-count"] as const;

export function usePrescriptionNewCount() {
  return useQuery<number>({
    queryKey: PRESCRIPTION_NEW_COUNT_KEY,
    queryFn: async () => {
      const { data } = await api.get("/prescriptions/new-count");
      return (data.data as { count: number }).count;
    },
    // Poll-based, not a real push channel yet — see notifySound.ts on when to escalate.
    //
    // 30s, and ONLY while the tab is actually on screen. The old 8s-always poll meant
    // every open tab (a pharmacist often has several) hit this COUNT endpoint ~7x/min
    // whether visible or not — at a few hundred concurrent staff that is a constant
    // ~100 req/s floor against a small connection pool for a badge number.
    // refetchIntervalInBackground:false stops hidden tabs entirely; refetchOnWindowFocus
    // gives an immediate refresh the moment a pharmacist switches back, so the longer
    // interval is not felt in practice.
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

/**
 * Fire-and-forget: called the moment a pharmacist opens a clinic-sourced row. Errors are
 * swallowed on purpose — a failed "mark as seen" must never block or disrupt opening the
 * prescription itself, it would just leave the badge one count stale until the next poll.
 */
export function markPrescriptionViewed(id: string, qc: ReturnType<typeof useQueryClient>) {
  api.patch(`/prescriptions/${id}/viewed`)
    .then(() => qc.invalidateQueries({ queryKey: PRESCRIPTION_NEW_COUNT_KEY }))
    .catch(() => {});
}
