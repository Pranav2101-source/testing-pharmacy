-- Index for the default Purchase Order list view:
--   WHERE "pharmacyId" = ? ORDER BY "orderedAt" DESC
-- (the unfiltered list — the most common read). Without it Postgres sorts the
-- pharmacy's POs on every page load. Mirrors the invoices list index.
--
-- Tiny table today, so this is future-proofing, not a current speedup. Plain
-- CREATE INDEX (not CONCURRENTLY) is fine at this size; if the table is large
-- when you apply this in the Supabase SQL editor, use the CONCURRENTLY variant
-- in the comment below instead (it must run outside a transaction).

CREATE INDEX IF NOT EXISTS "purchase_orders_pharmacyId_orderedAt_idx"
  ON "purchase_orders" ("pharmacyId", "orderedAt" DESC);

-- Large-table alternative (run on its own, not inside a transaction):
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "purchase_orders_pharmacyId_orderedAt_idx"
--   ON "purchase_orders" ("pharmacyId", "orderedAt" DESC);
