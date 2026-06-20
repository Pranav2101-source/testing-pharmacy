-- StockAuditSession.createdBy: add FK constraint to users.id.
--
-- approvedBy was fixed earlier (migration 20260619000001). createdBy on the
-- same model was still a plain string — inconsistent and unverifiable.
-- Who created a session is as important as who approved it for audit purposes.
--
-- ON DELETE RESTRICT: we do NOT set null on user delete here because createdBy
-- is NOT NULL — it cannot be nulled without changing the column nullable.
-- Using RESTRICT means: a user who created audit sessions cannot be deleted
-- until those sessions are either reassigned or the sessions are deleted.
-- This is the correct policy for regulatory audit data.
--
-- Pre-flight: NULL out (impossible since NOT NULL — just validate) any createdBy
-- that does not resolve to a real user row.
DO $$
DECLARE bad_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_count
  FROM "stock_audit_sessions"
  WHERE "createdBy" NOT IN (SELECT id FROM "users");
  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'stock_audit_sessions: % row(s) have createdBy that does not match any user. Fix data before applying FK.', bad_count;
  END IF;
END $$;

ALTER TABLE "stock_audit_sessions"
  ADD CONSTRAINT "stock_audit_sessions_createdBy_fkey"
  FOREIGN KEY ("createdBy")
  REFERENCES "users"("id")
  ON UPDATE CASCADE;
