-- SupplierReturn / SupplierReturnItem: add full GST breakdown.
--
-- A debit note issued when returning goods to a supplier must include the same
-- tax components as a purchase invoice under CGST Rule 53. Previously only
-- totalAmount was stored, making GSTR-2B reconciliation and ITC reversals
-- impossible without re-computing tax from line items at reporting time.
--
-- All new columns default to 0 so existing rows remain valid and the NOT NULL
-- constraint is satisfied without a data migration. The application already
-- computed these values in memory — they are now persisted.

-- Header GST breakdown on supplier_returns
ALTER TABLE "supplier_returns"
  ADD COLUMN IF NOT EXISTS "subtotal"      DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "taxableAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cgst"          DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sgst"          DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "igst"          DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "totalGst"      DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Line-level GST breakdown on supplier_return_items
ALTER TABLE "supplier_return_items"
  ADD COLUMN IF NOT EXISTS "taxableAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "gstRate"       DECIMAL(12,2) NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS "cgst"          DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sgst"          DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "igst"          DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Back-fill existing rows: derive taxableAmount from amount using the stored
-- gstRate default (12%) so the data is self-consistent, not all zeros.
-- amount = taxable × (1 + gstRate/100) => taxable = amount / (1 + 0.12) ≈ amount × 0.8929
-- This is an approximation for historical data; new rows will be precise.
UPDATE "supplier_return_items"
SET
  "taxableAmount" = ROUND("amount" / 1.12, 2),
  "cgst"          = ROUND("amount" / 1.12 * 0.06, 2),
  "sgst"          = ROUND("amount" / 1.12 * 0.06, 2);

-- Back-fill header totals from line aggregates.
UPDATE "supplier_returns" sr
SET
  "subtotal"      = agg."subtotal",
  "taxableAmount" = agg."subtotal",
  "cgst"          = agg."cgst",
  "sgst"          = agg."sgst",
  "totalGst"      = agg."cgst" + agg."sgst"
FROM (
  SELECT
    "returnId",
    ROUND(SUM("taxableAmount"), 2) AS "subtotal",
    ROUND(SUM("cgst"), 2)          AS "cgst",
    ROUND(SUM("sgst"), 2)          AS "sgst"
  FROM "supplier_return_items"
  GROUP BY "returnId"
) agg
WHERE sr.id = agg."returnId";
