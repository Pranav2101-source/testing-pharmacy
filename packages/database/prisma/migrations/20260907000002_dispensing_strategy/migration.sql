-- One authoritative batch-selection strategy per pharmacy, snapshotted onto every bill.
--
-- Until now the LIFA/LILA toggle was a frontend-only setting that only the manual
-- billing search read (a client-side expiry sort); the backend, EMR dispensing,
-- Quick Add and Repeat Last Bill all silently did FEFO. This column is what the new
-- DispensingService (Java) reads for every dispensing path.

-- CreateEnum
CREATE TYPE "DispensingStrategy" AS ENUM ('LILA_FEFO', 'LIFA');

-- AlterTable: the pharmacy-wide setting. LILA_FEFO (earliest valid expiry first) is
-- the safe default and what every existing pharmacy was effectively already getting.
ALTER TABLE "pharmacies"
  ADD COLUMN "dispensingStrategy" "DispensingStrategy" NOT NULL DEFAULT 'LILA_FEFO';

-- AlterTable: the per-bill snapshot. Nullable on purpose — every row that predates
-- this column reads as "not recorded", which is honest; back-filling a strategy the
-- code did not actually consult when the bill was made would be a fabricated audit
-- trail. New bills always write it.
ALTER TABLE "invoices"
  ADD COLUMN "dispensingStrategy" "DispensingStrategy";

-- AlterTable: was this line's batch chosen by the engine (true) or overridden by a
-- pharmacist in the batch picker (false). Defaults true — legacy rows predate the
-- override flag and followed engine (FEFO) order.
ALTER TABLE "invoice_items"
  ADD COLUMN "batchAutoSelected" BOOLEAN NOT NULL DEFAULT true;
