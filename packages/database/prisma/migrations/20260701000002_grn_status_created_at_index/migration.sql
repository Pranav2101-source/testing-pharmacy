-- Composite index for the Gate Inward / Purchase / Overdue Bills list queries,
-- all of which run WHERE pharmacyId = ? AND status = ? ORDER BY createdAt DESC.
-- The existing (pharmacyId, status) and (pharmacyId, createdAt) indexes each
-- cover half the query; this covers both together so Postgres can satisfy the
-- filter and the sort from a single index scan instead of filtering then
-- re-sorting (or scanning past non-matching rows in createdAt order).

CREATE INDEX "goods_receipt_notes_pharmacyId_status_createdAt_idx"
  ON "goods_receipt_notes"("pharmacyId", "status", "createdAt" DESC);
