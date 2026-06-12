-- AlterTable
ALTER TABLE "customers" ALTER COLUMN "creditLimit" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "creditUsed" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "defaultDiscount" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "goods_receipt_notes" ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "totalGst" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "totalAmount" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "grn_items" ALTER COLUMN "purchaseRate" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "mrp" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "discount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "gstRate" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "cgst" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "sgst" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "inventory" ALTER COLUMN "purchaseRate" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "mrp" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "invoice_items" ALTER COLUMN "mrp" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "rate" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "discount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "gstRate" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "cgst" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "sgst" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "taxableAmount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "purchaseRate" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "igst" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "invoice_payments" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "invoices" ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "discountAmount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "taxableAmount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "cgst" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "sgst" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "totalGst" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "totalAmount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "returnedAmount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "igst" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "medicines" ALTER COLUMN "gstRate" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "catalogMrp" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "purchase_order_items" ALTER COLUMN "purchaseRate" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "mrp" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "gstRate" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "cgst" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "sgst" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "purchase_orders" ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "totalGst" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "totalAmount" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "quotation_items" ALTER COLUMN "quotedRate" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "mrp" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "gstRate" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "discount" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "sales_return_items" ALTER COLUMN "mrp" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "rate" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "discount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "gstRate" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "cgst" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "sgst" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "taxableAmount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "igst" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "sales_returns" ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "discountAmount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "taxableAmount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "cgst" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "sgst" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "totalGst" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "totalAmount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "igst" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "supplier_credit_notes" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "supplier_payments" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "supplier_return_items" ALTER COLUMN "purchaseRate" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "supplier_returns" ALTER COLUMN "totalAmount" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "suppliers" ALTER COLUMN "creditLimit" SET DATA TYPE DECIMAL(12,2);

-- CreateTable
CREATE TABLE "document_sequences" (
    "pharmacyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("pharmacyId","kind","period")
);

-- AddForeignKey
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Seed counters from existing document numbers ──────────────────────────────
-- New sequence values must continue past the highest number already issued via
-- the old Redis counters, or the unique (pharmacyId, number) constraints would
-- reject new documents. Trailing digits are extracted from each number format
-- (e.g. "INV/25-26/000042" -> 42). All historical numbers are folded into the
-- CURRENT financial-year counter: this can only over-count (harmless — numbers
-- just continue higher), never collide.

WITH fy AS (
  SELECT CASE
    WHEN EXTRACT(MONTH FROM (NOW() AT TIME ZONE 'Asia/Kolkata')) >= 4
    THEN EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Kolkata'))::int
    ELSE EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Kolkata'))::int - 1
  END AS y
),
seeds AS (
  SELECT "pharmacyId", 'INVOICE' AS kind,
         MAX(COALESCE(SUBSTRING("invoiceNumber" FROM '(\d+)$'), '0')::bigint) AS max_seq
  FROM "invoices" GROUP BY "pharmacyId"
  UNION ALL
  SELECT "pharmacyId", 'SALES_RETURN',
         MAX(COALESCE(SUBSTRING("returnNumber" FROM '(\d+)$'), '0')::bigint)
  FROM "sales_returns" GROUP BY "pharmacyId"
  UNION ALL
  SELECT "pharmacyId", 'PURCHASE_ORDER',
         MAX(COALESCE(SUBSTRING("orderNumber" FROM '(\d+)$'), '0')::bigint)
  FROM "purchase_orders" GROUP BY "pharmacyId"
  UNION ALL
  SELECT "pharmacyId", 'GRN',
         MAX(COALESCE(SUBSTRING("grnNumber" FROM '(\d+)$'), '0')::bigint)
  FROM "goods_receipt_notes" GROUP BY "pharmacyId"
  UNION ALL
  SELECT "pharmacyId", 'SUPPLIER_RETURN',
         MAX(COALESCE(SUBSTRING("returnNumber" FROM '(\d+)$'), '0')::bigint)
  FROM "supplier_returns" GROUP BY "pharmacyId"
  UNION ALL
  SELECT "pharmacyId", 'QUOTATION',
         MAX(COALESCE(SUBSTRING("quotationNumber" FROM '(\d+)$'), '0')::bigint)
  FROM "quotations" GROUP BY "pharmacyId"
)
INSERT INTO "document_sequences" ("pharmacyId", "kind", "period", "value", "updatedAt")
SELECT s."pharmacyId", s.kind, fy.y || '-' || (fy.y + 1), LEAST(s.max_seq, 2000000000)::int, NOW()
FROM seeds s, fy
WHERE s.max_seq > 0
ON CONFLICT ("pharmacyId", "kind", "period") DO NOTHING;

-- Stock audits use a per-day counter (AUDIT-YYYYMMDD-NNN); seed today's IST day.
INSERT INTO "document_sequences" ("pharmacyId", "kind", "period", "value", "updatedAt")
SELECT "pharmacyId", 'STOCK_AUDIT',
       TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD'),
       LEAST(MAX(COALESCE(SUBSTRING("sessionNumber" FROM '(\d+)$'), '0')::bigint), 2000000000)::int,
       NOW()
FROM "stock_audit_sessions"
GROUP BY "pharmacyId"
HAVING MAX(COALESCE(SUBSTRING("sessionNumber" FROM '(\d+)$'), '0')::bigint) > 0
ON CONFLICT ("pharmacyId", "kind", "period") DO NOTHING;
