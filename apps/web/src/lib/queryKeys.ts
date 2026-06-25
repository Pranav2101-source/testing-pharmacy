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
  },
  medicineStock: {
    byName: (name: string) => ["medicine-stock", name] as const,
  },
} as const;
