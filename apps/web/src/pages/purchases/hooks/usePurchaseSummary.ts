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
// /reports/purchases/summary now returns pendingApprovals/pendingGRNs counts
// directly (added alongside the existing overduePayments count), so this is
// one HTTP call instead of four — the other three used to exist only to read
// a list endpoint's `.total`, and one of them (overdue GRNs) duplicated the
// exact same count the summary endpoint already computed as overduePayments.
export function usePurchaseSummary() {
  return useQuery({
    queryKey: queryKeys.purchases.summary(),
    queryFn: async (): Promise<PurchaseSummary> => {
      const now  = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const to   = now.toISOString();
      const { data } = await api.get("/reports/purchases/summary", { params: { from, to } });
      const s = data.data;
      return {
        pendingGRNs:      s.pendingGRNs      ?? 0,
        overdueGRNs:       s.overduePayments  ?? 0, // same underlying count as overduePayments
        overduePayments:  s.overduePayments  ?? 0,
        pendingApprovals: s.pendingApprovals ?? 0,
        monthSpend:       s.totalSpend       ?? 0,
      };
    },
    staleTime: 30_000,
  });
}
