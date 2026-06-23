-- StockAuditSession.approvedBy: upgrade from plain string to a real FK
-- pointing at users.id. ON DELETE SET NULL so the audit record survives
-- even if the approving user account is later deactivated.
--
-- Pre-flight: NULL out any approvedBy values that do not resolve to a real
-- user row (e.g. leftover test data or plain-name strings from before the fix).
UPDATE "stock_audit_sessions"
SET    "approvedBy" = NULL
WHERE  "approvedBy" IS NOT NULL
  AND  "approvedBy" NOT IN (SELECT id FROM "users");

ALTER TABLE "stock_audit_sessions"
  ADD CONSTRAINT "stock_audit_sessions_approvedBy_fkey"
  FOREIGN KEY ("approvedBy")
  REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
