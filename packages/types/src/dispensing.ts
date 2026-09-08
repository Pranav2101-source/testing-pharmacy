// ─── Dispensing engine ───────────────────────────────────────────────────────
// The backend DispensingService is the single source of truth for batch selection
// and pack/loose allocation. The frontend never sorts batches or resolves
// pack-vs-loose itself — it reads these shapes off /api/v1/dispensing/*.

/** LILA_FEFO — earliest valid expiry first (default). LIFA — newest received batch first. */
export type DispensingStrategy = "LILA_FEFO" | "LIFA";

export type DispensingStrategyResponse = {
  strategy: DispensingStrategy;
  defaultStrategy: DispensingStrategy;
};

/** One batch's slice of a dispensing plan line. */
export type DispensingAllocation = {
  inventoryId: string;
  batchNumber: string;
  expiryDate: string;
  saleUnit: "PACK" | "LOOSE";
  /** Whole packs for PACK, individual pieces for LOOSE. */
  quantity: number;
  unitsPerPack: number | null;
  baseUnit: string | null;
  /**
   * The medicine's free-text catalogue pack size ("100ml", "1x15"), or null when it has
   * none. Display-only — lets the billing cart's Pack column show the real catalogue label
   * instead of a computed fallback. Never used in any allocation, pricing or stock decision.
   */
  packSize: string | null;
  /** Printed pack MRP, always. */
  mrp: number;
  /** Per-piece MRP for LOOSE, equal to `mrp` for PACK. */
  unitMrp: number;
  rate: number;
  gstRate: number;
  hsnCode: string | null;
  allowLooseSale: boolean;
  looseUnits: number;
  availableStock: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  amount: number;
};

export type DispensingPlanLine = {
  medicineId: string | null;
  localMedicineId: string | null;
  medicineName: string;
  schedule: string | null;
  requestedPieces: number;
  dispensedPieces: number;
  fullyAllocated: boolean;
  /** Pieces the shelf could not cover, when short. */
  shortfallPieces: number | null;
  /** Pieces billed over what was asked because a strip could not be cut. */
  roundedUpToPieces: number | null;
  /**
   * Why the line was not filled exactly, when it wasn't:
   * NO_STOCK — nothing sellable; NO_SELLABLE_UNIT — < 1 pack and loose off / Schedule X;
   * MEDICINE_UNAVAILABLE — the linked catalogue medicine is gone;
   * PARTIAL — allocated less than asked; ROUNDED_UP — allocated more than asked.
   */
  unmetReason:
    | "NO_STOCK"
    | "NO_SELLABLE_UNIT"
    | "MEDICINE_UNAVAILABLE"
    | "PARTIAL"
    | "ROUNDED_UP"
    | null;
  /** A short pharmacist-readable sentence for `unmetReason` — safe to show as-is. */
  message: string | null;
  allocations: DispensingAllocation[];
};

export type DispensingPlan = {
  strategy: DispensingStrategy;
  lines: DispensingPlanLine[];
};
