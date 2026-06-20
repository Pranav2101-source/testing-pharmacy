-- PurchaseOrder.approvedBy: add FK constraint to users.id.
--
-- Mirrors the fix already applied to StockAuditSession.approvedBy.
-- The column is already String? (nullable) so no data migration is needed
-- for rows where approval has not yet been recorded.
--
-- ON DELETE SET NULL: if the approving user is deleted, the approval record
-- survives (the approvedAt timestamp and approvalStatus remain) but the FK
-- is cleared. Historical PO audit trail is preserved.
--
-- Pre-flight: NULL out any approvedBy values that do not resolve to a real
-- user row (e.g. leftover test data or plain-name strings from before the fix).
UPDATE "purchase_orders"
SET    "approvedBy" = NULL
WHERE  "approvedBy" IS NOT NULL
  AND  "approvedBy" NOT IN (SELECT id FROM "users");

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_approvedBy_fkey"
  FOREIGN KEY ("approvedBy")
  REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
