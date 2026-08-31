import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export type MedicineHit = {
  id: string; name: string; genericName: string | null; strength: string | null; form: string | null;
};

/**
 * The catalogue-name-search query — identical in ReviewIngestedItemsPanel's "choose medicine"
 * search and StockActionPanel's "search medicine instead" fallback, previously copy-pasted in
 * both. Pulled out so a future change to this query (a new field, a minimum-length tweak, a
 * switch to barcode-aware search) lands once instead of twice; each caller still owns its own
 * result-list rendering and what a pick actually does, since those two genuinely differ
 * (linking a prescription line vs. resolving a FEFO batch to bill).
 */
export function useMedicineCatalogSearch(term: string, limit: number, enabled: boolean) {
  return useQuery<MedicineHit[]>({
    queryKey: ["medicine-search", term, limit],
    queryFn: async () => {
      const { data } = await api.get("/medicines", { params: { search: term, limit } });
      return data?.data?.items ?? data?.data ?? [];
    },
    enabled: enabled && term.trim().length >= 2,
  });
}
