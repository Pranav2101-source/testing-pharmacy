export type MedicineSchedule = "OTC" | "H" | "X" | "G";

export type MedicineForm =
  | "tablet"
  | "capsule"
  | "syrup"
  | "injection"
  | "cream"
  | "ointment"
  | "drops"
  | "inhaler"
  | "patch"
  | "suppository"
  | "other";

export type GstRate = 0 | 5 | 12;

/** The smallest unit a medicine is dispensed in when sold loose. */
export type MedicineBaseUnit = "TABLET" | "CAPSULE" | "ML" | "GM" | "EACH";

/**
 * How a billed line's quantity is counted.
 * PACK  — whole strips/bottles; mrp/rate are the printed pack price.
 * LOOSE — individual pieces cut from a strip; mrp/rate are per-piece.
 */
export type SaleUnit = "PACK" | "LOOSE";

export type MedicineSearchResult = {
  id: string;
  name: string;
  genericName: string | null;
  manufacturer: string | null;
  form: string | null;
  strength: string | null;
  packSize: string | null;
  hsnCode: string | null;
  gstRate: number;
  schedule: string | null;
  // Optional: the search index already returns these (see SEARCH_ATTRS); surfaced
  // in the POS as an at-a-glance product-type tag. Optional so no caller breaks.
  category?: string | null;
  unit?: string | null;
  hasAlternatives?: boolean;
  // ── Loose dispensing ──────────────────────────────────────────────────────
  // Base units in one pack (Crocin strip = 15). Null = not classified.
  unitsPerPack?: number | null;
  baseUnit?: string | null;
  // This pharmacy has enabled cut-strip sales for this medicine (needs unitsPerPack > 1).
  allowLooseSale?: boolean;
  // New bill lines for this medicine start as loose.
  looseByDefault?: boolean;
  // True when `id` is a pharmacy-local medicine id (see PharmacyMedicine on the backend),
  // not a global catalogue id — only ever set when the search was called with
  // includeLocal=true (the billing combobox). Callers must not pass this id to any
  // endpoint that expects a global medicineId (alternatives, classification, barcode).
  isLocal?: boolean;
  // ── Stock (billing search only, includeLocal=true) ────────────────────────
  // Computed backend-side from one batched join over the whole result page —
  // never recompute these from other fields; the backend owns FEFO/loose/pricing.
  inStock?: boolean;
  // Whole packs on hand, unreserved.
  availableQuantity?: number;
  looseUnitsOnHand?: number;
  // Total sellable base units (availableQuantity * unitsPerPack + looseUnitsOnHand).
  // Only set when this result is actually loose-sellable.
  sellableUnits?: number | null;
  // MRP of the earliest-expiring in-stock batch — what FEFO will actually charge next.
  price?: number | null;
};

export type AlternativeBatch = {
  id: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  looseUnits?: number;
  reservedQuantity: number;
  mrp: number;
  purchaseRate: number;
  location: string | null;
  shelf?: { code: string; rack: { code: string } } | null;
};

export type AlternativeResult = {
  id: string;
  name: string;
  manufacturer: string | null;
  genericName: string | null;
  strength: string | null;
  form: string | null;
  packSize: string | null;
  hsnCode: string | null;
  gstRate: number;
  schedule: string | null;
  brand: { id: string; name: string } | null;
  totalStock: number;
  mrp: number;
  margin: number | null;
  stockStatus: "in_stock" | "low_stock" | "out_of_stock";
  // Loose dispensing: effective pack size + this pharmacy's opt-in.
  unitsPerPack?: number | null;
  baseUnit?: string | null;
  /** The catalogue's packaging word ("Strip", "Bottle", "Tube") — see `DispensingAllocation.unit`. */
  unit?: string | null;
  allowLooseSale?: boolean;
  looseByDefault?: boolean;
  batches: AlternativeBatch[];
};
