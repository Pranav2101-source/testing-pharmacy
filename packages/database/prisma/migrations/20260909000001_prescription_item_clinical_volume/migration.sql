-- Structured clinical-volume tracking for a measured (ML / GM) prescription line, so a
-- syrup / cream course the clinic states as a millilitre / gram figure ("105 ml") is kept
-- as exactly that, and the whole-pack count it resolves to is stored beside it rather than
-- silently overwriting the clinical number.
--
-- Before this, a measured EMR line's `quantity` carried the clinic's millilitre figure and
-- the dispensing engine reinterpreted it: for an UNCLASSIFIED medicine (no pack size) the
-- bare "105" read as 105 sealed bottles. `deferAmbiguousMeasuredQuantity` blunted the worst
-- of it by holding such a line for a pharmacist, but a CLASSIFIED liquid (pack size known)
-- was billed 2 bottles for 105 ml correctly and then never closed, because the dispensed
-- write-back recorded 2 (packs) against a prescribed 105 (ml). These columns make the two
-- numbers first-class instead of one string-parsed note.

-- The clinical volume/weight the clinic prescribed for a measured line, verbatim — drives
-- the "Prescribed: 105 ml" display and the dosage line on the label. NULL for a countable
-- line (tablets / capsules / each) and for any line the clinic sent as a plain unit count.
ALTER TABLE "prescription_items" ADD COLUMN "prescribedVolumeClinical" DECIMAL(12,2);

-- The unit `prescribedVolumeClinical` is measured in — 'ML' | 'GM'. NULL whenever there is
-- no clinical volume on the line.
ALTER TABLE "prescription_items" ADD COLUMN "clinicalUom" TEXT;

-- Whole sealed packs the measured course was rounded UP to once the medicine's pack size
-- became known: ceil(prescribedVolumeClinical / effectiveUnitsPerPack). NULL while the pack
-- size is still unknown (the line is then held for a pharmacist to enter a pack count) and
-- for every countable line. Display / label / audit only — batch selection still runs
-- through DispensingService, and `quantity` already holds the resolved dispense target in
-- base units (roundedPackCount * unitsPerPack) so isFullyDispensed() compares like for like.
ALTER TABLE "prescription_items" ADD COLUMN "roundedPackCount" INTEGER;
