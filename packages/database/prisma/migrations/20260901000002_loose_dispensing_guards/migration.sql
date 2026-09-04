-- Loose dispensing — guards + a per-pharmacy unitsPerPack override.
--
-- 1. Tighten medicines.unitsPerPack to 1..100000 (20260901000001 only checked "> 0").
--    A pack multiple is a small count; a runaway value would break per-piece pricing
--    and the piece arithmetic. Matches Medicine.setPackaging.
--
-- 2. pharmacy_medicine_overrides.unitsPerPack — a pharmacy can set the real pack
--    size for a medicine the shared catalogue has not classified (or got wrong),
--    without waiting on a platform admin. Billing uses
--    COALESCE(override.unitsPerPack, medicine.unitsPerPack).
--
-- FAST: no table rewrite, no backfill. Re-runnable.

SET lock_timeout = '4s';

ALTER TABLE "medicines" DROP CONSTRAINT IF EXISTS "medicines_unitsPerPack_positive";
ALTER TABLE "medicines" ADD  CONSTRAINT "medicines_unitsPerPack_positive"
  CHECK ("unitsPerPack" IS NULL OR ("unitsPerPack" >= 1 AND "unitsPerPack" <= 100000));

ALTER TABLE "pharmacy_medicine_overrides"
  ADD COLUMN IF NOT EXISTS "unitsPerPack" INTEGER;
ALTER TABLE "pharmacy_medicine_overrides" DROP CONSTRAINT IF EXISTS "pmo_unitsPerPack_range";
ALTER TABLE "pharmacy_medicine_overrides" ADD CONSTRAINT "pmo_unitsPerPack_range"
  CHECK ("unitsPerPack" IS NULL OR ("unitsPerPack" >= 2 AND "unitsPerPack" <= 100000));

RESET lock_timeout;
