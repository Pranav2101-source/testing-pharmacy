-- Loose (cut-strip) remainder on a stock-audit count line — same three-column shape as the
-- existing pack columns (expectedQty/countedQty/varianceQty), snapshotting Inventory.looseUnits
-- instead of Inventory.quantity. Always 0 for a pack-only medicine, so this changes nothing
-- for the vast majority of the catalogue.
--
-- Additive, fast, safe to re-run.

SET lock_timeout = '4s';
ALTER TABLE "stock_audit_items"
  ADD COLUMN IF NOT EXISTS "expectedLooseUnits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "countedLooseUnits" INTEGER,
  ADD COLUMN IF NOT EXISTS "varianceLooseUnits" INTEGER;
RESET lock_timeout;
