-- Migration: 20260618000004_missing_indexes_2
-- Adds 10 indexes identified as missing.
-- Note: sales_return_items(invoiceItemId) was already indexed — skipped.

-- supplier_payments: GRN payment lookup
CREATE INDEX IF NOT EXISTS "supplier_payments_grnId_idx"
  ON "supplier_payments" ("grnId");

-- goods_receipt_notes: duplicate supplier-invoice detection scoped to pharmacy
CREATE INDEX IF NOT EXISTS "goods_receipt_notes_pharmacyId_supplierInvoiceNo_idx"
  ON "goods_receipt_notes" ("pharmacyId", "supplierInvoiceNo");

-- invoices: cashier-wise billing report
CREATE INDEX IF NOT EXISTS "invoices_pharmacyId_userId_idx"
  ON "invoices" ("pharmacyId", "userId");

-- inventory_movements: user-wise stock movement audit
CREATE INDEX IF NOT EXISTS "inventory_movements_pharmacyId_userId_createdAt_idx"
  ON "inventory_movements" ("pharmacyId", "userId", "createdAt" DESC);

-- stock_audit_items: all audit sessions that covered a specific batch
CREATE INDEX IF NOT EXISTS "stock_audit_items_inventoryId_idx"
  ON "stock_audit_items" ("inventoryId");

-- support_tickets: user-wise ticket history
CREATE INDEX IF NOT EXISTS "support_tickets_raisedById_idx"
  ON "support_tickets" ("raisedById");

-- medicines: manufacturer-wise filtering + active-only queries
CREATE INDEX IF NOT EXISTS "medicines_manufacturer_idx"
  ON "medicines" ("manufacturer");

CREATE INDEX IF NOT EXISTS "medicines_isActive_idx"
  ON "medicines" ("isActive");

-- notification_logs: filtering failed SMS/WhatsApp by type + status
CREATE INDEX IF NOT EXISTS "notification_logs_pharmacyId_type_status_idx"
  ON "notification_logs" ("pharmacyId", "type", "status");

-- Soft-delete standardisation: add isActive indexes so filtered list
-- queries on Supplier and Doctor hit the index instead of scanning.
CREATE INDEX IF NOT EXISTS "suppliers_pharmacyId_isActive_idx"
  ON "suppliers" ("pharmacyId", "isActive");

CREATE INDEX IF NOT EXISTS "doctors_pharmacyId_isActive_idx"
  ON "doctors" ("pharmacyId", "isActive");
