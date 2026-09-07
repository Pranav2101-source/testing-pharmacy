import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { DispensingStrategy, DispensingStrategyResponse } from "@pharmacy/types";

const KEY = ["dispensing", "strategy"] as const;

/**
 * The pharmacy's batch-selection strategy — a persisted shop setting, not a
 * per-bill toggle. Read here so the billing sub-nav, the settings screen and the
 * batch picker label all reflect the same stored value. The actual batch ordering
 * happens backend-side in DispensingService; this only surfaces / changes the
 * setting.
 */
export function useDispensingStrategy() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: KEY,
    queryFn: () =>
      api
        .get<{ data: DispensingStrategyResponse }>("/dispensing/strategy")
        .then((r) => r.data.data),
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: (strategy: DispensingStrategy) =>
      api
        .put<{ data: DispensingStrategyResponse }>("/dispensing/strategy", { strategy })
        .then((r) => r.data.data),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
      // Re-resolve any cached prescription plans / batch lists under the new order.
      qc.invalidateQueries({ queryKey: ["dispensing"] });
    },
  });

  return {
    strategy: query.data?.strategy ?? "LILA_FEFO",
    defaultStrategy: query.data?.defaultStrategy ?? "LILA_FEFO",
    isLoading: query.isLoading,
    /** True while the newest-first (LIFA) mode is active. */
    lifa: (query.data?.strategy ?? "LILA_FEFO") === "LIFA",
    setStrategy: mutation.mutate,
    setStrategyAsync: mutation.mutateAsync,
    saving: mutation.isPending,
  };
}
