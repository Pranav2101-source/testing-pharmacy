-- Composite indexes on stock_audit_items for fast per-session aggregations
-- (listSessions enrichment, completeSession uncounted check)

CREATE INDEX IF NOT EXISTS "stock_audit_items_sessionId_countedQty_idx"
  ON "stock_audit_items" ("sessionId", "countedQty");

CREATE INDEX IF NOT EXISTS "stock_audit_items_sessionId_varianceQty_idx"
  ON "stock_audit_items" ("sessionId", "varianceQty");
