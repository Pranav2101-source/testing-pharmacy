export const queryKeys = {
  suppliers: {
    all: () => ["suppliers", "all"] as const,
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
