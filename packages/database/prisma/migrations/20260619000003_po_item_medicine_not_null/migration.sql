-- PurchaseOrderItem.medicineId: enforce NOT NULL at DB level.
-- The Zod schema already required medicineId at API level; this migration
-- makes the database column match so no orphaned items can exist even via
-- direct DB writes or future migrations.
--
-- PurchaseOrderItem.inventoryId: drop the column entirely.
-- It was never written or read by any application code — the FK existed in
-- the schema but the column was always NULL. Removing it eliminates dead
-- weight and the confusing unused FK to inventory.

-- 1. Backfill any nulls before adding NOT NULL (safety guard for existing data).
--    In practice no rows should have a NULL medicineId since the API always
--    required it, but the guard prevents the migration from failing if any slip
--    through (e.g. direct inserts during development).
DELETE FROM "purchase_order_items" WHERE "medicineId" IS NULL;

-- 2. Enforce NOT NULL on medicineId.
ALTER TABLE "purchase_order_items"
  ALTER COLUMN "medicineId" SET NOT NULL;

-- 3. Drop the unused inventoryId column and its FK constraint.
ALTER TABLE "purchase_order_items"
  DROP COLUMN IF EXISTS "inventoryId";
