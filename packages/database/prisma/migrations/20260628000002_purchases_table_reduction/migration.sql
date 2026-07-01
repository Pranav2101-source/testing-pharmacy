-- Migration A (additive only): reduces the Purchases module from 9 tables to 6.
--
-- Adds `items` (JSONB) + `itemCount` to purchase_orders and supplier_returns
-- (folding PurchaseOrderItem / SupplierReturnItem off dedicated child tables —
-- verified beforehand that neither is queried directly outside relational
-- includes, and neither feeds any cross-row report/aggregate), and creates
-- `supplier_ledger_entries`, a single table merging SupplierPayment +
-- SupplierCreditNote behind a `type` discriminator (mirrors the existing
-- Upload/UploadType pattern already used in this schema).
--
-- The 4 legacy tables (purchase_order_items, supplier_return_items,
-- supplier_payments, supplier_credit_notes) are intentionally left in place,
-- untouched and unused by application code after this ships. Dropping them
-- is a deliberate separate follow-up migration, gated on this one having run
-- cleanly for a while — see Migration B (not included here).

-- ── purchase_orders: items JSON + itemCount ────────────────────────────────

ALTER TABLE "purchase_orders" ADD COLUMN "items" JSONB;
ALTER TABLE "purchase_orders" ADD COLUMN "itemCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "purchase_orders" po
SET "items"     = COALESCE(sub.items, '[]'::jsonb),
    "itemCount" = COALESCE(sub.cnt, 0)
FROM (
  SELECT
    poi."purchaseOrderId" AS id,
    jsonb_agg(jsonb_build_object(
      'medicineId',   poi."medicineId",
      'medicineName', poi."medicineName",
      'batchNumber',  poi."batchNumber",
      'expiryDate',   poi."expiryDate",
      'quantity',     poi."quantity",
      'purchaseRate', poi."purchaseRate",
      'mrp',          poi."mrp",
      'gstRate',      poi."gstRate",
      'cgst',         poi."cgst",
      'sgst',         poi."sgst",
      'amount',       poi."amount"
    ) ORDER BY poi."id") AS items,
    COUNT(*) AS cnt
  FROM "purchase_order_items" poi
  GROUP BY poi."purchaseOrderId"
) sub
WHERE po.id = sub.id;

UPDATE "purchase_orders" SET "items" = '[]'::jsonb WHERE "items" IS NULL;
ALTER TABLE "purchase_orders" ALTER COLUMN "items" SET NOT NULL;

-- ── supplier_returns: items JSON + itemCount ───────────────────────────────

ALTER TABLE "supplier_returns" ADD COLUMN "items" JSONB;
ALTER TABLE "supplier_returns" ADD COLUMN "itemCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "supplier_returns" sr
SET "items"     = COALESCE(sub.items, '[]'::jsonb),
    "itemCount" = COALESCE(sub.cnt, 0)
FROM (
  SELECT
    sri."returnId" AS id,
    jsonb_agg(jsonb_build_object(
      'inventoryId',   sri."inventoryId",
      'medicineId',    sri."medicineId",
      'medicineName',  sri."medicineName",
      'batchNumber',   sri."batchNumber",
      'expiryDate',    sri."expiryDate",
      'quantity',      sri."quantity",
      'purchaseRate',  sri."purchaseRate",
      'taxableAmount', sri."taxableAmount",
      'gstRate',       sri."gstRate",
      'cgst',          sri."cgst",
      'sgst',          sri."sgst",
      'igst',          sri."igst",
      'amount',        sri."amount",
      'reason',        sri."reason"
    ) ORDER BY sri."id") AS items,
    COUNT(*) AS cnt
  FROM "supplier_return_items" sri
  GROUP BY sri."returnId"
) sub
WHERE sr.id = sub.id;

UPDATE "supplier_returns" SET "items" = '[]'::jsonb WHERE "items" IS NULL;
ALTER TABLE "supplier_returns" ALTER COLUMN "items" SET NOT NULL;

-- ── supplier_ledger_entries: new merged table ──────────────────────────────

CREATE TYPE "SupplierLedgerEntryType" AS ENUM ('PAYMENT', 'CREDIT_NOTE');

CREATE TABLE "supplier_ledger_entries" (
    "id"               TEXT NOT NULL,
    "pharmacyId"       TEXT NOT NULL,
    "supplierId"       TEXT NOT NULL,
    "type"             "SupplierLedgerEntryType" NOT NULL,
    "entryNumber"      TEXT NOT NULL,
    "amount"           DECIMAL(12,2) NOT NULL,
    "grnId"            TEXT,
    "paymentMode"      "PaymentMode",
    "paidAt"           TIMESTAMP(3),
    "supplierReturnId" TEXT,
    "status"           "CreditNoteStatus",
    "issuedAt"         TIMESTAMP(3),
    "reference"        TEXT,
    "notes"            TEXT,
    "createdBy"        TEXT NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_ledger_entries_pharmacyId_type_entryNumber_key" ON "supplier_ledger_entries"("pharmacyId", "type", "entryNumber");
CREATE INDEX "supplier_ledger_entries_pharmacyId_type_supplierId_idx"        ON "supplier_ledger_entries"("pharmacyId", "type", "supplierId");
CREATE INDEX "supplier_ledger_entries_pharmacyId_type_status_idx"           ON "supplier_ledger_entries"("pharmacyId", "type", "status");
CREATE INDEX "supplier_ledger_entries_pharmacyId_type_paidAt_idx"           ON "supplier_ledger_entries"("pharmacyId", "type", "paidAt");
CREATE INDEX "supplier_ledger_entries_pharmacyId_type_issuedAt_idx"         ON "supplier_ledger_entries"("pharmacyId", "type", "issuedAt");
CREATE INDEX "supplier_ledger_entries_grnId_idx"                            ON "supplier_ledger_entries"("grnId");
CREATE INDEX "supplier_ledger_entries_supplierReturnId_idx"                ON "supplier_ledger_entries"("supplierReturnId");

ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_pharmacyId_fkey"       FOREIGN KEY ("pharmacyId")       REFERENCES "pharmacies"("id")           ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_supplierId_fkey"       FOREIGN KEY ("supplierId")       REFERENCES "suppliers"("id")            ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_grnId_fkey"            FOREIGN KEY ("grnId")            REFERENCES "goods_receipt_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_supplierReturnId_fkey" FOREIGN KEY ("supplierReturnId") REFERENCES "supplier_returns"("id")     ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_createdBy_fkey"        FOREIGN KEY ("createdBy")        REFERENCES "users"("id")                ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS — mirrors every other tenant table's policy exactly
-- (see 20260618000002_row_level_security/migration.sql)
ALTER TABLE "supplier_ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_ledger_entries" FORCE ROW LEVEL SECURITY;

CREATE POLICY "supplier_ledger_entries_tenant_isolation" ON "supplier_ledger_entries"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- Backfill from supplier_payments (ids preserved so any historical
-- AuditLog.entityId string still resolves against the new table)
INSERT INTO "supplier_ledger_entries"
  ("id", "pharmacyId", "supplierId", "type", "entryNumber", "amount", "grnId", "paymentMode", "paidAt", "reference", "notes", "createdBy", "createdAt", "updatedAt")
SELECT
  "id", "pharmacyId", "supplierId", 'PAYMENT', "paymentNumber", "amount", "grnId", "paymentMode", "paidAt", "reference", "notes", "createdBy", "createdAt", "updatedAt"
FROM "supplier_payments";

-- Backfill from supplier_credit_notes
INSERT INTO "supplier_ledger_entries"
  ("id", "pharmacyId", "supplierId", "type", "entryNumber", "amount", "supplierReturnId", "status", "issuedAt", "notes", "createdBy", "createdAt", "updatedAt")
SELECT
  "id", "pharmacyId", "supplierId", 'CREDIT_NOTE', "creditNoteNumber", "amount", "supplierReturnId", "status", "issuedAt", "notes", "createdBy", "createdAt", "updatedAt"
FROM "supplier_credit_notes";
