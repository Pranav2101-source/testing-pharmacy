-- Migration: 20260618000003_missing_indexes
-- Adds 4 indexes that were identified as missing:
--   • grn_items(medicineId)       — purchase rate history / price trend analysis
--   • grn_items(inventoryId)      — batch traceability (which GRN created/updated a batch)
--   • invoices(pharmacyId, doctorId) — doctor-wise prescription reports
--   • customers(pharmacyId, email)   — customer lookup by email

CREATE INDEX IF NOT EXISTS "grn_items_medicineId_idx"
  ON "grn_items" ("medicineId");

CREATE INDEX IF NOT EXISTS "grn_items_inventoryId_idx"
  ON "grn_items" ("inventoryId");

CREATE INDEX IF NOT EXISTS "invoices_pharmacyId_doctorId_idx"
  ON "invoices" ("pharmacyId", "doctorId");

CREATE INDEX IF NOT EXISTS "customers_pharmacyId_email_idx"
  ON "customers" ("pharmacyId", "email");
