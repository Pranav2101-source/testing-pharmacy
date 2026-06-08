-- GIN trigram indexes for invoice search.
-- Run this ONCE directly in the Neon SQL editor (not via prisma migrate).
-- Prisma's shadow database does not have pg_trgm pre-installed, so these
-- cannot live in a standard migration file.

-- 1. Enable the extension (safe to run multiple times)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. GIN indexes — one per search column.
--    Postgres uses all three via bitmap-OR for the ILIKE OR predicate,
--    turning a full-table scan into an index scan.
CREATE INDEX IF NOT EXISTS "invoices_invoice_number_trgm_idx"
  ON "invoices" USING GIN ("invoiceNumber" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "invoices_customer_name_trgm_idx"
  ON "invoices" USING GIN ("customerName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "invoices_customer_phone_trgm_idx"
  ON "invoices" USING GIN ("customerPhone" gin_trgm_ops);
