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
    // Cheap step toward "instant": tighter polling, not a real push channel yet — see
    // notifySound.ts's doc comment on when to escalate to WebSocket/SSE instead.
    staleTime: 5_000,
    refetchInterval: 8_000,
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
