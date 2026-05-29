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
};
