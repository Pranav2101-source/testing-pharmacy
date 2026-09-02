-- Per-pharmacy loose-POS conveniences on the medicine override:
--   looseByDefault    new bill lines for this medicine start as LOOSE (a shop that
--                     breaks every strip stops toggling on every sale)
--   looseConfirmedAt  the pharmacist has checked the pack size against a real strip
--
-- Additive, fast, safe to re-run.

SET lock_timeout = '4s';
ALTER TABLE "pharmacy_medicine_overrides"
  ADD COLUMN IF NOT EXISTS "looseByDefault" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "looseConfirmedAt" TIMESTAMP(3);
RESET lock_timeout;
