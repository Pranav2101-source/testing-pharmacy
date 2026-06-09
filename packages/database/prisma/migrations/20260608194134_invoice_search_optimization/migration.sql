-- Add denormalized customer snapshot columns to Invoice for fast invoice search.
-- Initial migration — IF NOT EXISTS guards allow safe re-runs.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "customerName"  TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT;
