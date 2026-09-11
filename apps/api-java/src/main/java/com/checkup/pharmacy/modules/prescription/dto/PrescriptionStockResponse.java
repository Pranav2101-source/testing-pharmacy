package com.checkup.pharmacy.modules.prescription.dto;

import java.util.List;

/**
 * Live stock, per prescribed line, for the triage screen's stock-check step.
 *
 * <p>Deliberately its own endpoint rather than folded into {@link PrescriptionResponse}: a
 * prescription is read far more often than its stock changes (every list-page render, every
 * poll), and a batch getting sold or received should not require a fresh {@code /prescriptions}
 * round trip to be reflected. Computed in one batched query per {@link
 * com.checkup.pharmacy.modules.prescription.PrescriptionService#stockCheck}, not one FEFO
 * lookup per line — this is a preview for a human to scan, not a reservation, so it does not
 * need FEFO's batch-picking order.
 */
public record PrescriptionStockResponse(List<Item> items) {

    /**
     * @param itemId       the prescription line this describes.
     * @param medicineId   the catalogue product being checked.
     * @param availableQty total non-expired, active stock across all this pharmacy's batches,
     *                     as a PIECE count — sealed packs converted through the effective pack
     *                     multiple (this pharmacy's override first: see {@code
     *                     PharmacyMedicineOverride#effectivePackMultiple}) plus each batch's
     *                     open loose remainder. The same unit a prescription line's own
     *                     {@code quantity} is in, so the two are directly comparable.
     * @param stockStatus  {@code "out_of_stock"}, {@code "low_stock"}, or {@code "in_stock"} —
     *                     same three-way classification and threshold as the billing
     *                     alternatives drawer, so a pharmacist reads the same colour for the
     *                     same stock level everywhere in the app.
     * @param baseUnit     resolved smallest dispensable unit ("TABLET" | "CAPSULE" | "ML" |
     *                     "GM" | "EACH"), and
     * @param unit         the catalogue's packaging word ("Strip", "Bottle", "Tube") or null.
     *                     Both are here purely so the triage screen can NAME the numbers above
     *                     — "1050 tablets", not a bare "1050". The screen resolves them through
     *                     the shared {@code saleUnitModel}, exactly as the billing cart does,
     *                     rather than either side inventing its own noun.
     * @param effectivePackSize for a MEASURED line, the mL/g in one sealed pack as resolved
     *                     RIGHT NOW ({@code PharmacyMedicineOverride#effectiveUnitsPerPack} —
     *                     this pharmacy's override first, catalogue second). Null when the line
     *                     is countable or nothing has classified the pack size.
     * @param projectedPackCount sealed packs the dispensing engine will allocate for the
     *                     quantity still owed on this line, at {@code effectivePackSize} —
     *                     {@code ceil(remaining / packSize)}. Null when it cannot be projected.
     * @param packCountWarning a pharmacist-readable sentence when {@code projectedPackCount} is
     *                     an implausible course for this dosage form, else null. See
     *                     {@code DispensePlausibility}.
     *
     *                     <p>These last three are computed LIVE rather than read from the line's
     *                     own stored {@code roundedPackCount}, and that distinction is the whole
     *                     point of putting them here. A line is resolved to a pack target once,
     *                     at ingest; the catalogue can be reclassified afterwards, and nothing
     *                     re-resolves it. A prescription taken in while a medicine was still
     *                     unclassified therefore carries NO measured metadata at all — the
     *                     triage screen has nothing to render — while the dispensing engine,
     *                     reading today's catalogue, silently divides the same stored number by
     *                     a pack size that did not exist when it was written. Projecting from
     *                     live data is what lets triage show the pharmacist the arithmetic
     *                     billing is actually about to perform, not the arithmetic that applied
     *                     the day the prescription arrived.
     * @param packSizeConfidence how far the pack size that conversion divides by may be trusted —
     *                     {@code "VERIFIED"}, {@code "UNVERIFIED"}, {@code "DISPUTED"}, or null
     *                     when nothing has classified the medicine at all. The trust state of
     *                     {@code effectivePackSize} itself, so this pharmacy's own confirmation
     *                     of that number counts (see {@code
     *                     PharmacyMedicineOverride#effectivePackSizeConfidence}) — the catalogue
     *                     row's verdict alone would keep a chip up after a pharmacist here had
     *                     checked the bottle.
     *
     *                     <p>The plausibility warning above only fires when the ARITHMETIC comes
     *                     out strange, and a wrong pack size does not always produce a strange
     *                     answer: halve a bottle size and a two-bottle course quietly becomes
     *                     four, under every ceiling, on every screen. This says something
     *                     different and says it always — not "that number looks odd" but "nobody
     *                     has ever checked the number this was divided by". The triage screen
     *                     renders it as a quiet chip rather than a warning for exactly that
     *                     reason: it is true of a great deal of an ordinary catalogue, and a
     *                     warning that fires on half the lines is one nobody reads.
     */
    public record Item(String itemId, String medicineId, int availableQty, String stockStatus,
                       String baseUnit, String unit, Integer effectivePackSize,
                       Integer projectedPackCount, String packCountWarning,
                       String packSizeConfidence) {
    }
}
