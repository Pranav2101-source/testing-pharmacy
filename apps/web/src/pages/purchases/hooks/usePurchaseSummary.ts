import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/queryKeys";

export interface PurchaseSummary {
  pendingGRNs:      number;
  overdueGRNs:       number;
  overduePayments:  number;
  pendingApprovals: number;
  monthSpend:       number;
}

// Single shared query for the Purchase page header badges + SummaryBar cards.
// Both consumers used to fire their own independent api.get() calls (one of
// which — approvalStatus=PENDING_APPROVAL — was an exact duplicate); this
// hook lets React Query dedupe/cache the lot behind one query key.
export function usePurchaseSummary() {
  return useQuery({
    queryKey: queryKeys.purchases.summary(),
    queryFn: async (): Promise<PurchaseSummary> => {
      const now  = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const to   = now.toISOString();
      const [grnDraftRes, grnOverdueRes, poRes, summaryRes] = await Promise.all([
        api.get("/purchases/grn",    { params: { status: "DRAFT", limit: 1 } }),
        api.get("/purchases/grn",    { params: { overdue: true, status: "CONFIRMED", limit: 1 } }),
        api.get("/purchases/orders", { params: { approvalStatus: "PENDING_APPROVAL", limit: 1 } }),
        api.get("/reports/purchases/summary", { params: { from, to } }),
      ]);
      return {
        pendingGRNs:      grnDraftRes.data.data.total   ?? 0,
        overdueGRNs:       grnOverdueRes.data.data.total ?? 0,
        overduePayments:  summaryRes.data.data.overduePayments ?? 0,
        pendingApprovals: poRes.data.data.total ?? 0,
        monthSpend:       summaryRes.data.data.totalSpend ?? 0,
      };
    },
    staleTime: 30_000,
  });
}
