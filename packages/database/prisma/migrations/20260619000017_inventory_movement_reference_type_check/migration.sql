-- InventoryMovement.referenceType: normalize values and add CHECK constraint.
--
-- Historical values in this column were inconsistently named:
--   "invoice"          → written by billing create path (lowercase snake_case)
--   "invoice_cancel"   → written by billing cancel path (lowercase snake_case)
--   "sales_return"     → written by sales return path (lowercase snake_case)
--   "StockAuditSession"→ written by stock-audit approve path (PascalCase)
--   "BATCH_RECALL"     → inventory recall (SCREAMING_SNAKE — correct)
--   "GRN"              → purchases confirm (SCREAMING_SNAKE — correct)
--   "SUPPLIER_RETURN"  → supplier return confirm (SCREAMING_SNAKE — correct)
--   "STATUS_CHANGE:X->Y" → dynamic free-form string (non-enumerable)
--   "CORRECTION" etc.  → adjustment reasons (SCREAMING_SNAKE — correct)
--
-- All application write paths have been updated to SCREAMING_SNAKE_CASE.
-- This migration normalizes all existing rows to match, then adds a CHECK
-- constraint so future values cannot diverge.
--
-- Note: The STATUS_CHANGE rows had their state-transition detail embedded
-- in referenceType ("STATUS_CHANGE:ACTIVE->DAMAGED"). After this migration,
-- referenceType = "STATUS_CHANGE" and the detail moves to the `notes` column
-- (which is where the application now writes it too).

-- Step 1: normalize existing rows to SCREAMING_SNAKE_CASE.
UPDATE "inventory_movements"
SET "referenceType" = CASE "referenceType"
  WHEN 'invoice'            THEN 'INVOICE'
  WHEN 'invoice_cancel'     THEN 'INVOICE_CANCEL'
  WHEN 'sales_return'       THEN 'SALES_RETURN'
  WHEN 'StockAuditSession'  THEN 'STOCK_AUDIT'
  ELSE CASE
    WHEN "referenceType" LIKE 'STATUS_CHANGE:%' THEN 'STATUS_CHANGE'
    ELSE "referenceType"   -- already correct: GRN, BATCH_RECALL, SUPPLIER_RETURN, adjustment reasons
  END
END
WHERE "referenceType" IS NOT NULL;

-- Step 2: add CHECK constraint for all valid values.
ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_referenceType_check"
  CHECK (
    "referenceType" IS NULL OR "referenceType" IN (
      'GRN',
      'INVOICE',
      'INVOICE_CANCEL',
      'SALES_RETURN',
      'SUPPLIER_RETURN',
      'BATCH_RECALL',
      'STATUS_CHANGE',
      'STOCK_AUDIT',
      'CORRECTION',
      'DAMAGE',
      'EXPIRY_WRITEOFF',
      'OPENING_BALANCE',
      'TRANSFER',
      'THEFT',
      'BREAKAGE',
      'STOCK_COUNT',
      'OTHER'
    )
  );
