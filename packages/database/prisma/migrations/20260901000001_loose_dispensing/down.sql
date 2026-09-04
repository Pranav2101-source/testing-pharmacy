-- Reverse of 20260901000001_loose_dispensing. Additive migration → clean drop.
-- Any loose sales already recorded lose their saleUnit flag (all read as PACK)
-- and any opened-pack remainder in inventory.looseUnits is discarded.

ALTER TABLE "pharmacy_medicine_overrides" DROP COLUMN IF EXISTS "allowLooseSale";

ALTER TABLE "invoice_items" DROP CONSTRAINT IF EXISTS "invoice_items_saleUnit_check";
ALTER TABLE "invoice_items" DROP COLUMN IF EXISTS "saleUnit";

ALTER TABLE "inventory" DROP CONSTRAINT IF EXISTS "inventory_looseUnits_nonneg";
ALTER TABLE "inventory" DROP COLUMN IF EXISTS "looseUnits";

ALTER TABLE "medicines" DROP CONSTRAINT IF EXISTS "medicines_unitsPerPack_positive";
ALTER TABLE "medicines" DROP COLUMN IF EXISTS "baseUnit";
ALTER TABLE "medicines" DROP COLUMN IF EXISTS "unitsPerPack";
