-- Tracks whether a prescription line's quantity was derived from its dosage + duration
-- (see PrescriptionQuantityCalculator, Java) rather than sent by the clinic.
--
-- Purely informational: nothing branches on this column, it only lets the triage screen
-- label a computed quantity as computed instead of showing it indistinguishably from one
-- the clinic stated. Defaults false so every existing row reads as "as the clinic sent it",
-- which is true of all of them — this feature did not exist when they were ingested.
ALTER TABLE "prescription_items" ADD COLUMN "quantityAutoCalculated" BOOLEAN NOT NULL DEFAULT false;

-- Explains that quantity in a pharmacist-readable sentence: how it was calculated when
-- quantityAutoCalculated is true, or why it could not be when the line still needs manual
-- confirmation (see PrescriptionQuantityCalculator.Result). Null on every existing row —
-- neither outcome ever applied to a line ingested before this feature existed.
ALTER TABLE "prescription_items" ADD COLUMN "quantityCalculationNote" TEXT;
