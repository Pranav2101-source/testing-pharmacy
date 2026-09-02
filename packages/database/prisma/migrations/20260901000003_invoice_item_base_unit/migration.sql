-- Snapshot the base unit ("TABLET" | "CAPSULE" | "ML" | "GM" | "EACH") on each
-- invoice line, alongside the medicineName / hsnCode snapshots already stored, so a
-- re-printed old bill can say "8 tab" instead of a generic "8 loose". Only ever set
-- for a LOOSE line; NULL everywhere else and on every legacy row. Additive, fast.

SET lock_timeout = '4s';
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "baseUnit" TEXT;
RESET lock_timeout;
