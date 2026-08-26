-- GoodsReceiptNote.createdBy / confirmedBy: track which staff member created and
-- confirmed each GRN. Previously a GRN carried no attribution at all (BaseEntity
-- only stamps createdAt/updatedAt, not who acted). Opening GRN create/confirm to
-- MANAGER and PHARMACIST (not just OWNER) means a mistaken or disputed entry now
-- needs to be traceable to a person.
--
-- Both columns are nullable: existing GRNs predate this column and have no
-- attribution to backfill — they will read as "unknown" going forward.
--
-- ON DELETE SET NULL mirrors PurchaseOrder.approvedBy (see
-- 20260619000005_po_approved_by_fk): if the acting user is later deleted, the
-- GRN and its totals/confirmedAt stay intact, only the link to the user clears.
ALTER TABLE "goods_receipt_notes"
  ADD COLUMN "createdBy" TEXT,
  ADD COLUMN "confirmedBy" TEXT;

ALTER TABLE "goods_receipt_notes"
  ADD CONSTRAINT "goods_receipt_notes_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "goods_receipt_notes"
  ADD CONSTRAINT "goods_receipt_notes_confirmedBy_fkey"
  FOREIGN KEY ("confirmedBy") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
