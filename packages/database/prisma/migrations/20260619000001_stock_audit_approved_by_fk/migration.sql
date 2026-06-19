-- StockAuditSession.approvedBy: upgrade from plain string to a real FK
-- pointing at users.id. ON DELETE SET NULL so the audit record survives
-- even if the approving user account is later deactivated.

ALTER TABLE "stock_audit_sessions"
  ADD CONSTRAINT "stock_audit_sessions_approvedBy_fkey"
  FOREIGN KEY ("approvedBy")
  REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
