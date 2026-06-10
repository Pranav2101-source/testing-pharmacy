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
  hasAlternatives?: boolean;
};

export type AlternativeBatch = {
  id: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  reservedQuantity: number;
  mrp: number;
  purchaseRate: number;
  location: string | null;
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
  brand: { id: string; name: string } | null;
  totalStock: number;
  mrp: number;
  margin: number | null;
  stockStatus: "in_stock" | "low_stock" | "out_of_stock";
  batches: AlternativeBatch[];
};
