-- Date a debit note by when the goods actually went back.
--
-- WHAT WAS WRONG
-- GSTR-3B Table 4(B) (input tax credit reversed) was built from EVERY supplier return in
-- the period, whatever its status, keyed on `createdAt`. Two separate defects fell out of
-- that:
--
--   1. DRAFT and CANCELLED returns reversed credit. A supplier return computes and stores
--      its cgst/sgst/igst at CREATION time and then sits in DRAFT until someone confirms
--      it; `cancel()` only flips the status and leaves those tax columns populated. So the
--      return reversed credit for goods still sitting on the shelf, and for debit notes
--      that had been explicitly abandoned. Table 4(C) net ITC came out understated and the
--      pharmacy paid the difference in cash.
--
--   2. The two halves of Table 4 described different events. Credit is CLAIMED on
--      `goods_receipt_notes.confirmedAt` — the moment the goods were accepted. Reversing on
--      `createdAt` meant a return drafted on 30 March and confirmed on 5 April reversed in
--      March a credit that was claimed in April.
--
-- BACKFILL: `updatedAt`, NOT `createdAt`. Confirming is an UPDATE to the row (it writes
-- status), so for a return that reached CONFIRMED the `updatedAt` timestamp is the closest
-- record this database holds of when that happened — and there is no edit path for a
-- confirmed return that could have moved it since. `createdAt` would reproduce exactly the
-- date basis this migration exists to correct. This is an approximation for historic rows
-- only; everything written from now on is stamped by `SupplierReturn.confirm()`.
--
-- DRAFT and CANCELLED rows are deliberately LEFT NULL. They have no date on which anything
-- went back, and null is what lets the 3B query filter on this column directly rather than
-- having to re-test the status and hope the two agree.
--
-- Adding a nullable column takes no table-rewrite lock on Postgres, so this is safe to run
-- against a live pharmacy mid-day. The UPDATE touches only supplier returns, a small table.
--
-- IF NOT EXISTS / idempotent UPDATE because this is applied to Supabase BY HAND — Railway
-- never runs `prisma migrate deploy` here, and a hand-run that stops half way must be safe
-- to repeat.
ALTER TABLE "supplier_returns" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);

UPDATE "supplier_returns"
   SET "confirmedAt" = "updatedAt"
 WHERE "status" = 'CONFIRMED'
   AND "confirmedAt" IS NULL;
