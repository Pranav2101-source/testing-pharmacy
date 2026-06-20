-- Two previously missing indexes on high-frequency query paths.
--
-- 1. goods_receipt_notes (pharmacyId, purchaseOrderId)
--    The most common GRN query is "all GRNs for this PO" (PO detail page join).
--    Without an index Postgres scanned all GRN rows for the pharmacy on every
--    PO detail load.
--
-- 2. purchase_order_items (pharmacyId, medicineId)
--    Medicine-wise purchase history ("what did we pay for Paracetamol 500mg
--    over the last 6 months?") is a reporting query that was doing a full
--    pharmacy-scoped scan of all PO item rows.

CREATE INDEX IF NOT EXISTS "goods_receipt_notes_pharmacyId_purchaseOrderId_idx"
  ON "goods_receipt_notes"("pharmacyId", "purchaseOrderId");

CREATE INDEX IF NOT EXISTS "purchase_order_items_pharmacyId_medicineId_idx"
  ON "purchase_order_items"("pharmacyId", "medicineId");
