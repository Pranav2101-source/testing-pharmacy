ALTER TABLE "pharmacy_medicine_overrides" DROP CONSTRAINT IF EXISTS "pmo_unitsPerPack_range";
ALTER TABLE "pharmacy_medicine_overrides" DROP COLUMN IF EXISTS "unitsPerPack";

ALTER TABLE "medicines" DROP CONSTRAINT IF EXISTS "medicines_unitsPerPack_positive";
ALTER TABLE "medicines" ADD  CONSTRAINT "medicines_unitsPerPack_positive"
  CHECK ("unitsPerPack" IS NULL OR "unitsPerPack" > 0);
