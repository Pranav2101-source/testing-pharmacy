-- Supplier.ledgerBalance: add memoized running balance.
--
-- Without this, every supplier balance read required two aggregate queries:
--   SUM(GRN.totalAmount WHERE status=CONFIRMED) - SUM(SupplierPayment.amount)
-- At scale (hundreds of GRNs + payments per supplier) this becomes expensive,
-- and the supplier list page triggered it N times simultaneously.
--
-- The balance is now maintained transactionally:
--   GRN confirm:           ledgerBalance += grn.totalAmount
--   SupplierPayment create: ledgerBalance -= payment.amount
--   SupplierReturn confirm: ledgerBalance -= supplierReturn.totalAmount
--
-- Positive balance: pharmacy owes supplier.
-- Negative balance: supplier owes pharmacy (over-payment or pending credit note).
--
-- Migration: add column then back-fill from the authoritative aggregate.

ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "ledgerBalance" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Back-fill: compute the correct balance for every existing supplier.
UPDATE "suppliers" s
SET "ledgerBalance" = COALESCE(grn_totals."total", 0)
                    - COALESCE(pay_totals."total", 0)
                    - COALESCE(sr_totals."total",  0)
FROM (
  SELECT "supplierId", SUM("totalAmount") AS "total"
  FROM   "goods_receipt_notes"
  WHERE  "status" = 'CONFIRMED'
  GROUP  BY "supplierId"
) grn_totals
FULL OUTER JOIN (
  SELECT "supplierId", SUM("amount") AS "total"
  FROM   "supplier_payments"
  GROUP  BY "supplierId"
) pay_totals USING ("supplierId")
FULL OUTER JOIN (
  SELECT "supplierId", SUM("totalAmount") AS "total"
  FROM   "supplier_returns"
  WHERE  "status" = 'CONFIRMED'
  GROUP  BY "supplierId"
) sr_totals USING ("supplierId")
WHERE s.id = COALESCE(grn_totals."supplierId", pay_totals."supplierId", sr_totals."supplierId");
