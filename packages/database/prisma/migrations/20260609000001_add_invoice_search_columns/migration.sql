-- Add denormalized customer snapshot columns to Invoice for fast search.
-- IF NOT EXISTS guards against re-running on a DB where a previous partial
-- attempt already added the columns.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "customerName"  TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT;
