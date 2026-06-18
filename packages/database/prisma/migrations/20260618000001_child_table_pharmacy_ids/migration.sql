-- Migration: Add pharmacyId to 9 child tables (defense-in-depth tenant isolation)
-- and fix missing indexes + FKs flagged in security audit.
--
-- Strategy per child table:
--   1. Add column as nullable
--   2. Backfill from parent JOIN (single UPDATE per table)
--   3. Set NOT NULL (fast — no rewrite for pg >= 11 when default exists;
--      backfill ensures no nulls so the constraint check passes immediately)
--   4. Add FK constraint (DEFERRABLE INITIALLY IMMEDIATE so migrations are safe)
--   5. Add index on pharmacyId

-- ─── invoice_items ────────────────────────────────────────────────────────────

ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "pharmacyId" TEXT;

UPDATE "invoice_items" ii
SET    "pharmacyId" = i."pharmacyId"
FROM   "invoices" i
WHERE  ii."invoiceId" = i.id
  AND  ii."pharmacyId" IS NULL;

ALTER TABLE "invoice_items" ALTER COLUMN "pharmacyId" SET NOT NULL;

ALTER TABLE "invoice_items"
  ADD CONSTRAINT "invoice_items_pharmacyId_fkey"
  FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX IF NOT EXISTS "invoice_items_pharmacyId_idx" ON "invoice_items"("pharmacyId");

-- Batch-recall index: find all invoice lines for a given inventory batch
-- (needed for drug recall operations — was a full-table scan before this)
CREATE INDEX IF NOT EXISTS "invoice_items_inventoryId_idx" ON "invoice_items"("inventoryId");

-- ─── sales_return_items ───────────────────────────────────────────────────────

ALTER TABLE "sales_return_items" ADD COLUMN IF NOT EXISTS "pharmacyId" TEXT;

UPDATE "sales_return_items" sri
SET    "pharmacyId" = sr."pharmacyId"
FROM   "sales_returns" sr
WHERE  sri."returnId" = sr.id
  AND  sri."pharmacyId" IS NULL;

ALTER TABLE "sales_return_items" ALTER COLUMN "pharmacyId" SET NOT NULL;

ALTER TABLE "sales_return_items"
  ADD CONSTRAINT "sales_return_items_pharmacyId_fkey"
  FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX IF NOT EXISTS "sales_return_items_pharmacyId_idx" ON "sales_return_items"("pharmacyId");

-- FK linking a return line to the original invoice line it reversed.
-- Previously a plain nullable string; enforcing the FK prevents a return
-- item from referencing an invoice item that belongs to a different pharmacy.
ALTER TABLE "sales_return_items"
  ADD CONSTRAINT "sales_return_items_invoiceItemId_fkey"
  FOREIGN KEY ("invoiceItemId") REFERENCES "invoice_items"(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX IF NOT EXISTS "sales_return_items_invoiceItemId_idx" ON "sales_return_items"("invoiceItemId");

-- ─── purchase_order_items ─────────────────────────────────────────────────────

ALTER TABLE "purchase_order_items" ADD COLUMN IF NOT EXISTS "pharmacyId" TEXT;

UPDATE "purchase_order_items" poi
SET    "pharmacyId" = po."pharmacyId"
FROM   "purchase_orders" po
WHERE  poi."purchaseOrderId" = po.id
  AND  poi."pharmacyId" IS NULL;

ALTER TABLE "purchase_order_items" ALTER COLUMN "pharmacyId" SET NOT NULL;

ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_pharmacyId_fkey"
  FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX IF NOT EXISTS "purchase_order_items_pharmacyId_idx" ON "purchase_order_items"("pharmacyId");

-- ─── grn_items ────────────────────────────────────────────────────────────────

ALTER TABLE "grn_items" ADD COLUMN IF NOT EXISTS "pharmacyId" TEXT;

UPDATE "grn_items" gi
SET    "pharmacyId" = grn."pharmacyId"
FROM   "goods_receipt_notes" grn
WHERE  gi."grnId" = grn.id
  AND  gi."pharmacyId" IS NULL;

ALTER TABLE "grn_items" ALTER COLUMN "pharmacyId" SET NOT NULL;

ALTER TABLE "grn_items"
  ADD CONSTRAINT "grn_items_pharmacyId_fkey"
  FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX IF NOT EXISTS "grn_items_pharmacyId_idx" ON "grn_items"("pharmacyId");

-- ─── supplier_return_items ────────────────────────────────────────────────────

ALTER TABLE "supplier_return_items" ADD COLUMN IF NOT EXISTS "pharmacyId" TEXT;

UPDATE "supplier_return_items" sri
SET    "pharmacyId" = sr."pharmacyId"
FROM   "supplier_returns" sr
WHERE  sri."returnId" = sr.id
  AND  sri."pharmacyId" IS NULL;

ALTER TABLE "supplier_return_items" ALTER COLUMN "pharmacyId" SET NOT NULL;

ALTER TABLE "supplier_return_items"
  ADD CONSTRAINT "supplier_return_items_pharmacyId_fkey"
  FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX IF NOT EXISTS "supplier_return_items_pharmacyId_idx" ON "supplier_return_items"("pharmacyId");

-- ─── quotation_items ──────────────────────────────────────────────────────────

ALTER TABLE "quotation_items" ADD COLUMN IF NOT EXISTS "pharmacyId" TEXT;

UPDATE "quotation_items" qi
SET    "pharmacyId" = q."pharmacyId"
FROM   "quotations" q
WHERE  qi."quotationId" = q.id
  AND  qi."pharmacyId" IS NULL;

ALTER TABLE "quotation_items" ALTER COLUMN "pharmacyId" SET NOT NULL;

ALTER TABLE "quotation_items"
  ADD CONSTRAINT "quotation_items_pharmacyId_fkey"
  FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX IF NOT EXISTS "quotation_items_pharmacyId_idx" ON "quotation_items"("pharmacyId");

-- ─── stock_audit_items ────────────────────────────────────────────────────────

ALTER TABLE "stock_audit_items" ADD COLUMN IF NOT EXISTS "pharmacyId" TEXT;

UPDATE "stock_audit_items" sai
SET    "pharmacyId" = sas."pharmacyId"
FROM   "stock_audit_sessions" sas
WHERE  sai."sessionId" = sas.id
  AND  sai."pharmacyId" IS NULL;

ALTER TABLE "stock_audit_items" ALTER COLUMN "pharmacyId" SET NOT NULL;

ALTER TABLE "stock_audit_items"
  ADD CONSTRAINT "stock_audit_items_pharmacyId_fkey"
  FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX IF NOT EXISTS "stock_audit_items_pharmacyId_idx" ON "stock_audit_items"("pharmacyId");

-- ─── ticket_messages ──────────────────────────────────────────────────────────

ALTER TABLE "ticket_messages" ADD COLUMN IF NOT EXISTS "pharmacyId" TEXT;

UPDATE "ticket_messages" tm
SET    "pharmacyId" = st."pharmacyId"
FROM   "support_tickets" st
WHERE  tm."ticketId" = st.id
  AND  tm."pharmacyId" IS NULL;

ALTER TABLE "ticket_messages" ALTER COLUMN "pharmacyId" SET NOT NULL;

ALTER TABLE "ticket_messages"
  ADD CONSTRAINT "ticket_messages_pharmacyId_fkey"
  FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX IF NOT EXISTS "ticket_messages_pharmacyId_idx" ON "ticket_messages"("pharmacyId");

-- ─── ticket_attachments ───────────────────────────────────────────────────────

ALTER TABLE "ticket_attachments" ADD COLUMN IF NOT EXISTS "pharmacyId" TEXT;

UPDATE "ticket_attachments" ta
SET    "pharmacyId" = st."pharmacyId"
FROM   "support_tickets" st
WHERE  ta."ticketId" = st.id
  AND  ta."pharmacyId" IS NULL;

ALTER TABLE "ticket_attachments" ALTER COLUMN "pharmacyId" SET NOT NULL;

ALTER TABLE "ticket_attachments"
  ADD CONSTRAINT "ticket_attachments_pharmacyId_fkey"
  FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX IF NOT EXISTS "ticket_attachments_pharmacyId_idx" ON "ticket_attachments"("pharmacyId");

-- ─── invoices.prescriptionId → uploads(id) ───────────────────────────────────
-- prescriptionId was a plain nullable string. Enforce FK so a deleted upload
-- automatically nullifies the invoice reference (ON DELETE SET NULL).

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_prescriptionId_fkey"
  FOREIGN KEY ("prescriptionId") REFERENCES "uploads"(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;
