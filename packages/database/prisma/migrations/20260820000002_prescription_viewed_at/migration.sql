-- The nav badge needs to know which clinic-sourced prescriptions nobody at this pharmacy
-- has opened yet. The existing "New" row pill on the Prescriptions page is in-memory only
-- (resets whenever that page unmounts), so it can't drive a badge that persists across
-- navigation — this column is the durable signal for that.
--
-- NULL means "never opened", for every prescription regardless of source; only a
-- clinic-sourced one (externalEmrPrescriptionId NOT NULL) is ever queried on it. Additive
-- and idempotent, nothing backfilled.
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "viewedAt" TIMESTAMP(3);
