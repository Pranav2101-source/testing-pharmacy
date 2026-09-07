export const queryKeys = {
  suppliers: {
    all:  () => ["suppliers", "all"] as const,
    list: (params: Record<string, unknown>) => ["suppliers", "list", params] as const,
  },
  purchases: {
    grn:     (params: Record<string, unknown>) => ["purchases", "grn", params] as const,
    orders:  (params: Record<string, unknown>) => ["purchases", "orders", params] as const,
    returns: (params: Record<string, unknown>) => ["purchases", "returns", params] as const,
    summary: () => ["purchases", "summary"] as const,
  },
  inventory: {
    list: (params: {
      page:       number;
      search:     string;
      status:     string;
      inStock:    boolean;
      lowStock:   boolean;
      nearExpiry: boolean;
    }) => ["inventory", "list", params] as const,
    ledger: (params: Record<string, unknown>) => ["inventory", "ledger", params] as const,
    alerts: () => ["inventory", "alerts"] as const,
    /** Every stocked medicine, deduped — the candidate set for "Set up loose selling". */
    looseSetupCandidates: () => ["inventory", "loose-setup-candidates"] as const,
  },
  medicineStock: {
    /** In-stock, loose-sale-eligible batches — what the billing search combobox and cart's loose-overflow split both need. */
    byName:    (name: string) => ["medicine-stock", name] as const,
    /** Every batch including out-of-stock — what the cart's "change batch" swap picker needs. */
    byNameAll: (name: string) => ["medicine-stock-all", name] as const,
  },
  dispensing: {
    strategy: () => ["dispensing", "strategy"] as const,
    /** Sellable batches for a medicine, already ordered by the pharmacy's strategy — the batch picker's authoritative list. */
    batches:  (id: string, local: boolean) => ["dispensing", "batches", local ? "local" : "cat", id] as const,
    /** Auto-dispensing plan for a whole prescription. */
    prescriptionPlan: (id: string) => ["dispensing", "prescription-plan", id] as const,
  },
} as const;
