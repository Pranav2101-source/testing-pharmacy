import type { QueryClient } from "@tanstack/react-query";

// ─────────────────────────────────────────────────────────────────────────────
// Keeps every surface that shows a product's category/packaging in sync after a
// change, from wherever it was made (catalog form, inventory, add-stock, POS).
//
// Two-step, so updates feel instant AND stay correct:
//   1. Optimistically patch the already-cached query data for the changed
//      medicine — the tag flips immediately, and this survives any HTTP/CDN
//      caching on the search endpoint (we mutate the client cache directly).
//   2. Invalidate the related queries so a background refetch reconciles with
//      the server — no spinner, old data stays on screen until fresh arrives.
// ─────────────────────────────────────────────────────────────────────────────

type Classification = { category: string | null; unit: string | null };

/** Instantly reflect a category/packaging change in all cached surfaces. */
export function patchProductClassification(
  qc: QueryClient,
  medicineId: string,
  next: Classification,
): void {
  // POS / add-stock search results — cached value is MedicineSearchResult[].
  qc.setQueriesData<unknown>({ queryKey: ["medicine-search"] }, (old: unknown) => {
    if (!Array.isArray(old)) return old;
    return old.map((m) =>
      m && typeof m === "object" && (m as { id?: string }).id === medicineId
        ? { ...(m as object), category: next.category, unit: next.unit }
        : m,
    );
  });

  // Inventory list pages — cached value is { items: InventoryItem[], ... }.
  qc.setQueriesData<unknown>({ queryKey: ["inventory", "list"] }, (old: unknown) => {
    const o = old as { items?: Array<{ medicine?: { id?: string } }> } | undefined;
    if (!o?.items) return old;
    return {
      ...o,
      items: o.items.map((it) =>
        it?.medicine?.id === medicineId
          ? { ...it, medicine: { ...it.medicine, category: next.category, unit: next.unit } }
          : it,
      ),
    };
  });
}

/** Refetch the surfaces affected by a classification change.
 *  Note: we deliberately do NOT invalidate "medicine-search" — that endpoint
 *  carries a short public HTTP cache, so a background refetch could return a
 *  stale body and clobber the optimistic patch above. The optimistic patch
 *  keeps cached results correct, the server re-indexes on write, and any fresh
 *  search fetches new data — so search stays right without the clobber risk. */
export function invalidateProductClassification(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ["inventory"] });
  void qc.invalidateQueries({ queryKey: ["medicine-stock"] });
}

/** Instant patch + background reconcile — the one call sites should use. */
export function syncProductClassification(
  qc: QueryClient,
  medicineId: string,
  next: Classification,
): void {
  patchProductClassification(qc, medicineId, next);
  invalidateProductClassification(qc);
}
