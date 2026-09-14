-- Phase 2B: a bill can be settled from a deposit the customer paid earlier.
--
-- PaymentMode.ADVANCE lets that settlement be written as a real invoice_payments
-- row. It has to be a real row: the tendered-vs-legacy era test in
-- InvoiceRepository keys off "does this bill carry a payment stamped at or before
-- its own createdAt", so a bill settled from an advance with no payment row would
-- be read as a pre-split-tender bill and re-counted under its dominant mode.
--
-- cash_closures.advanceSales holds what the day's billing drew from deposits. It is
-- reported separately and NOT added to expected cash: that money entered the drawer
-- on the day the deposit was taken, where it is already counted under the mode it
-- was paid in.
--
-- Both statements are safe in one transaction. Postgres refuses to USE a new enum
-- value in the transaction that adds it, and nothing here does — the column is
-- DECIMAL and no row is written.

SET lock_timeout = '4s';

-- AlterEnum
ALTER TYPE "PaymentMode" ADD VALUE IF NOT EXISTS 'ADVANCE';

-- AlterTable
ALTER TABLE "cash_closures" ADD COLUMN IF NOT EXISTS "advanceSales" DECIMAL(12,2) NOT NULL DEFAULT 0;

RESET lock_timeout;
