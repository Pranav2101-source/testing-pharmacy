package com.checkup.pharmacy.modules.prescription;

import com.checkup.pharmacy.modules.medicine.Medicine;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@code isFullyDispensed()} decides when a prescription closes as DISPENSED
 * ({@code BillingService.recordDispensing}) and when a retry reports "everything collected"
 * ({@code EmrDispenseCallbackRetryService.buildEvent}). A line the clinic sent with no usable
 * quantity is ingested as {@code quantity == 0} rather than rejected (see
 * {@code ClinicIngestService}) — this covers the regression where that placeholder read as
 * "already fully dispensed" from the moment the line was created, closing a prescription with
 * an unconfirmed line the instant every OTHER line was sold.
 */
class PrescriptionItemTest {

    @Test
    @DisplayName("a line with an unconfirmed (zero) quantity is never fully dispensed, even with dispensedQty at zero too")
    void unconfirmedQuantityLineIsNeverFullyDispensed() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Paracetamol",
                "med_1", null, 0, null, null, null);

        assertThat(item.needsQuantityConfirmation()).isTrue();
        assertThat(item.isFullyDispensed())
                .as("0 >= 0 must not read as 'fully dispensed' — that is a placeholder, not a real amount")
                .isFalse();
    }

    @Test
    @DisplayName("recording units against an unconfirmed line still does not mark it fully dispensed")
    void recordingDispenseAgainstAnUnconfirmedLineDoesNotCloseIt() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Paracetamol",
                "med_1", null, 0, null, null, null);

        item.recordDispensed(5);

        assertThat(item.isFullyDispensed()).isFalse();
    }

    @Test
    @DisplayName("a normal positive-quantity line behaves exactly as before")
    void normalQuantityLineIsUnaffected() {
        PrescriptionItem item = PrescriptionItem.create("ph_1", "rx_1", "Paracetamol", "med_1",
                null, 10, null, null, null);

        assertThat(item.needsQuantityConfirmation()).isFalse();
        assertThat(item.isFullyDispensed()).isFalse();

        item.recordDispensed(10);

        assertThat(item.isFullyDispensed()).isTrue();
    }

    @Test
    @DisplayName("confirming a quantity turns the placeholder into a real, dispensable amount")
    void confirmingQuantityMakesTheLineDispensable() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Paracetamol",
                "med_1", null, 0, null, null, null);

        item.confirmQuantity(6);

        assertThat(item.needsQuantityConfirmation()).isFalse();
        assertThat(item.getQuantity()).isEqualTo(6);
        assertThat(item.isFullyDispensed()).isFalse();

        item.recordDispensed(6);
        assertThat(item.isFullyDispensed()).isTrue();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // calculateQuantityIfMissing() — the entity-level entry point EmrIntegrationService
    // and PrescriptionService.linkItemToMedicine both call once a medicine is known for a
    // line that still needs a quantity. See PrescriptionQuantityCalculatorTest for the
    // calculator's own parsing rules; this covers what the ENTITY does with the result.
    // ─────────────────────────────────────────────────────────────────────────

    private static Medicine tablet(Integer unitsPerPack) {
        Medicine medicine = Medicine.create("Azithromycin 500", new BigDecimal("12"));
        medicine.setPackaging(unitsPerPack, "TABLET");
        return medicine;
    }

    @Test
    @DisplayName("a calculable line gets the quantity, the auto-calculated flag, and a note explaining the formula")
    void calculateQuantityIfMissingAppliesACalculableResult() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Azithromycin 500",
                "med_1", null, 0, "1-0-1", "6 days", null);

        item.calculateQuantityIfMissing(tablet(10));

        assertThat(item.getQuantity()).isEqualTo(12);
        assertThat(item.isQuantityAutoCalculated()).isTrue();
        assertThat(item.needsQuantityConfirmation()).isFalse();
        assertThat(item.getQuantityCalculationNote()).contains("1-0-1").contains("6 days").contains("12");
    }

    @Test
    @DisplayName("a non-calculable line (ML) keeps its placeholder quantity but records why, for the pharmacist")
    void calculateQuantityIfMissingRecordsAReasonWhenItCannotCalculate() {
        Medicine syrup = Medicine.create("Cough Syrup", new BigDecimal("12"));
        syrup.setPackaging(null, "ML");
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Cough Syrup",
                "med_1", null, 0, "10ml-0-10ml", "6 days", null);

        item.calculateQuantityIfMissing(syrup);

        assertThat(item.getQuantity()).isZero();
        assertThat(item.needsQuantityConfirmation()).isTrue();
        assertThat(item.isQuantityAutoCalculated()).isFalse();
        assertThat(item.getQuantityCalculationNote()).containsIgnoringCase("millilitres");
    }

    @Test
    @DisplayName("a line that already has a real quantity is never recalculated over, even if the medicine "
            + "and dosage would produce a different number")
    void calculateQuantityIfMissingDoesNothingOnceAQuantityIsAlreadySet() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Azithromycin 500",
                "med_1", null, 7, "1-0-1", "6 days", null);

        item.calculateQuantityIfMissing(tablet(10));

        assertThat(item.getQuantity()).as("the clinic's own 7 is untouched, not overwritten with the calculated 12")
                .isEqualTo(7);
        assertThat(item.isQuantityAutoCalculated()).isFalse();
        assertThat(item.getQuantityCalculationNote()).isNull();
    }

    @Test
    @DisplayName("a null medicine is a safe no-op, not an NPE — an unmatched line simply has nothing to check against")
    void calculateQuantityIfMissingIsANoOpWithNoMedicine() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Unknown Drug",
                null, null, 0, "1-0-1", "6 days", null);

        item.calculateQuantityIfMissing(null);

        assertThat(item.getQuantity()).isZero();
        assertThat(item.needsQuantityConfirmation()).isTrue();
        assertThat(item.getQuantityCalculationNote()).isNull();
    }

    @Test
    @DisplayName("confirming a quantity by hand clears any earlier calculation flag and note")
    void confirmQuantityClearsTheCalculationState() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Cough Syrup",
                "med_1", null, 0, "10ml-0-10ml", "6 days", null);
        item.recordQuantityCalculationNote("This medicine is measured in millilitres...");

        item.confirmQuantity(100);

        assertThat(item.getQuantity()).isEqualTo(100);
        assertThat(item.isQuantityAutoCalculated()).isFalse();
        assertThat(item.getQuantityCalculationNote())
                .as("the refusal note no longer describes this line once a human has settled it")
                .isNull();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // resolveMeasuredEmrQuantity() — a clinic states a syrup / cream course as a
    // millilitre / gram figure (dose × freq × duration of a liquid IS a volume).
    // When the pack size is known it is rounded UP to whole sealed packs (a bottle
    // can't be split); when it is not, it is held for a pharmacist rather than let
    // through as a bottle count. See DispensingService.resolveChunk.
    // ─────────────────────────────────────────────────────────────────────────

    private static Medicine syrup(Integer unitsPerPack) {
        Medicine medicine = Medicine.create("Melgain 60ml", new BigDecimal("12"));
        medicine.setPackaging(unitsPerPack, "ML");
        return medicine;
    }

    @Test
    @DisplayName("a clinic volume for a measured, unclassified medicine is dropped back to needs-confirmation, "
            + "keeping the clinic's figure in the note and on the line")
    void resolveMeasuredEmrQuantitySetsAsideAnUnclassifiedMeasuredLine() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Melgain",
                "med_1", null, 30, "3ml-0-3ml", "5 days", null);

        item.resolveMeasuredEmrQuantity(syrup(null), null);

        assertThat(item.getQuantity()).isZero();
        assertThat(item.needsQuantityConfirmation()).isTrue();
        assertThat(item.isQuantityAutoCalculated()).isFalse();
        assertThat(item.getRoundedPackCount()).isNull();
        assertThat(item.getPrescribedVolumeClinical()).isEqualByComparingTo("30");
        assertThat(item.getClinicalUom()).isEqualTo("ML");
        assertThat(item.getQuantityCalculationNote())
                .contains("30 ml").containsIgnoringCase("no pack size");
    }

    /** A topical, so DispensePlausibility can judge the course — a bare ML form carries no ceiling. */
    private static Medicine topicalSolution(Integer unitsPerPack) {
        Medicine medicine = Medicine.create("Melgain", new BigDecimal("12"));
        medicine.applyFields(null, null, null, null, null, null, new BigDecimal("12"),
                "solution", null, "Bottle", null);
        medicine.setPackaging(unitsPerPack, "ML");
        return medicine;
    }

    @Test
    @DisplayName("an implausible pack count is held for a pharmacist rather than billed: 40 ml of a "
            + "topical against a bad 5 ml pack size would be 8 bottles")
    void resolveMeasuredEmrQuantityHoldsAnImplausiblePackCount() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Melgain",
                "med_1", null, 40, "1-0-1", "4 days", null);

        item.resolveMeasuredEmrQuantity(topicalSolution(5), 5);

        // Held, not rejected — the same state a line with NO pack size reaches, so
        // ConfirmQuantityPanel asks for a bottle count instead of billing eight of them.
        assertThat(item.getQuantity()).isZero();
        assertThat(item.needsQuantityConfirmation()).isTrue();
        assertThat(item.getRoundedPackCount()).isNull();
        // The clinic's own figure survives, so the pharmacist still sees what was prescribed.
        assertThat(item.getPrescribedVolumeClinical()).isEqualByComparingTo("40");
        assertThat(item.getClinicalUom()).isEqualTo("ML");
        assertThat(item.getQuantityCalculationNote())
                .contains("40 ml").contains("8 sealed bottles").contains("5 ml pack size");
    }

    @Test
    @DisplayName("the same course against the REAL 60 ml bottle resolves normally to one bottle")
    void resolveMeasuredEmrQuantityAcceptsAPlausiblePackCount() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Melgain",
                "med_1", null, 40, "1-0-1", "4 days", null);

        item.resolveMeasuredEmrQuantity(topicalSolution(60), 60);

        assertThat(item.getRoundedPackCount()).isEqualTo(1);
        assertThat(item.getQuantity()).isEqualTo(60);
        assertThat(item.needsQuantityConfirmation()).isFalse();
        assertThat(item.getQuantityCalculationNote()).contains("1 sealed bottle").contains("20 ml over");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // reResolveMeasuredEmrQuantity() — the catalogue can be reclassified after a
    // line was resolved, and nothing else reconciles the two. Narrow invariants:
    // EMR-sourced, nothing dispensed, and something actually changed.
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("the reported case: a line ingested while the medicine was unclassified is "
            + "re-resolved once the catalogue gains a base unit and a real bottle volume")
    void reResolvesALineIngestedBeforeTheMedicineWasClassified() {
        // Ingested when Melgain had no baseUnit: resolveMeasuredEmrQuantity returned early, so
        // the line stored a bare 40 and NO measured metadata at all.
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Melgain",
                "med_1", null, 40, "1-0-1", "4 days", null);
        assertThat(item.getClinicalUom()).isNull();
        assertThat(item.getRoundedPackCount()).isNull();

        // The catalogue is corrected to a 60 ml topical solution.
        assertThat(item.reResolveMeasuredEmrQuantity(topicalSolution(60), 60)).isTrue();

        assertThat(item.getRoundedPackCount()).isEqualTo(1);
        assertThat(item.getQuantity()).isEqualTo(60);
        assertThat(item.getPrescribedVolumeClinical()).isEqualByComparingTo("40");
        assertThat(item.getClinicalUom()).isEqualTo("ML");
    }

    @Test
    @DisplayName("re-resolution is idempotent — a second call against the same catalogue changes nothing")
    void reResolutionIsIdempotent() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Melgain",
                "med_1", null, 40, "1-0-1", "4 days", null);
        assertThat(item.reResolveMeasuredEmrQuantity(topicalSolution(60), 60)).isTrue();

        assertThat(item.reResolveMeasuredEmrQuantity(topicalSolution(60), 60)).isFalse();
        assertThat(item.getQuantity()).isEqualTo(60);
        assertThat(item.getRoundedPackCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("re-resolving from a corrected pack size uses the CLINIC's volume, not the "
            + "previously rounded-up target — otherwise every edit inflates the course")
    void reResolutionUsesTheClinicalVolumeNotTheRoundedTarget() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Melgain",
                "med_1", null, 40, "1-0-1", "4 days", null);
        // First resolved against a wrong 25 ml pack size: ceil(40/25) = 2 bottles, target 50 ml.
        // (Two bottles is within the topical ceiling, so this resolves rather than holding —
        // the point of this test is the arithmetic, not the guard.)
        item.resolveMeasuredEmrQuantity(topicalSolution(25), 25);
        assertThat(item.getQuantity()).isEqualTo(50);
        assertThat(item.getRoundedPackCount()).isEqualTo(2);

        // Corrected to 45 ml. From the clinic's 40 that is ONE bottle; from the rounded-up 50 it
        // would be two. The numbers are chosen so the two sources genuinely disagree.
        assertThat(item.reResolveMeasuredEmrQuantity(topicalSolution(45), 45)).isTrue();
        assertThat(item.getPrescribedVolumeClinical()).isEqualByComparingTo("40");
        assertThat(item.getRoundedPackCount()).isEqualTo(1);
        assertThat(item.getQuantity()).isEqualTo(45);
    }

    @Test
    @DisplayName("a line with anything already dispensed is never rewritten")
    void reResolutionRefusesAPartlyDispensedLine() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Melgain",
                "med_1", null, 40, "1-0-1", "4 days", null);
        item.recordDispensed(10);

        assertThat(item.reResolveMeasuredEmrQuantity(topicalSolution(60), 60)).isFalse();
        assertThat(item.getQuantity()).isEqualTo(40);
    }

    @Test
    @DisplayName("a counter-written line is never rewritten — its quantity is in whatever unit that form showed")
    void reResolutionRefusesANonEmrLine() {
        PrescriptionItem item = PrescriptionItem.create("ph_1", "rx_1", "Melgain",
                "med_1", null, 40, "1-0-1", "4 days", null);

        assertThat(item.reResolveMeasuredEmrQuantity(topicalSolution(60), 60)).isFalse();
        assertThat(item.getQuantity()).isEqualTo(40);
    }

    @Test
    @DisplayName("an unchanged classification is left strictly alone")
    void reResolutionRefusesWhenNothingChanged() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Melgain",
                "med_1", null, 120, "1-0-1", "4 days", null);
        item.resolveMeasuredEmrQuantity(topicalSolution(60), 60);
        assertThat(item.getRoundedPackCount()).isEqualTo(2);

        assertThat(item.reResolveMeasuredEmrQuantity(topicalSolution(60), 60)).isFalse();
        assertThat(item.getQuantity()).isEqualTo(120);

        // A countable line whose medicine is still countable is likewise untouched.
        PrescriptionItem tablets = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-2",
                "Pantoprazole", "med_2", null, 16, "1-0-1", "8 days", null);
        Medicine tablet = Medicine.create("Pantoprazole 40mg", new BigDecimal("12"));
        tablet.setPackaging(10, "TABLET");
        assertThat(tablets.reResolveMeasuredEmrQuantity(tablet, 10)).isFalse();
        assertThat(tablets.getQuantity()).isEqualTo(16);
    }

    @Test
    @DisplayName("re-resolution re-applies the plausibility ceiling: a still-wrong pack size holds the line")
    void reResolutionStillHoldsAnImplausibleResult() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Melgain",
                "med_1", null, 40, "1-0-1", "4 days", null);

        // Corrected from unclassified to an equally wrong 5 ml.
        assertThat(item.reResolveMeasuredEmrQuantity(topicalSolution(5), 5)).isTrue();

        assertThat(item.needsQuantityConfirmation()).isTrue();
        assertThat(item.getQuantity()).isZero();
        assertThat(item.getQuantityCalculationNote()).contains("8 sealed bottles");
    }

    @Test
    @DisplayName("a line held by the ceiling is released once the catalogue is corrected")
    void reResolutionReleasesAHeldLine() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Melgain",
                "med_1", null, 40, "1-0-1", "4 days", null);
        item.resolveMeasuredEmrQuantity(topicalSolution(5), 5);
        assertThat(item.needsQuantityConfirmation()).isTrue();

        assertThat(item.reResolveMeasuredEmrQuantity(topicalSolution(60), 60)).isTrue();

        assertThat(item.needsQuantityConfirmation()).isFalse();
        assertThat(item.getQuantity()).isEqualTo(60);
        assertThat(item.getRoundedPackCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("a classified measured medicine: 105 ml against a 100 ml bottle rounds up to 2 sealed bottles")
    void resolveMeasuredEmrQuantityRoundsUpAClassifiedMeasuredLine() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Melgain",
                "med_1", null, 105, "5ml-5ml-5ml", "7 days", null);

        item.resolveMeasuredEmrQuantity(syrup(100), 100);

        assertThat(item.getRoundedPackCount()).as("ceil(105 / 100)").isEqualTo(2);
        assertThat(item.getQuantity()).as("dispense target in mL — 2 sealed 100 ml bottles").isEqualTo(200);
        assertThat(item.getPrescribedVolumeClinical()).isEqualByComparingTo("105");
        assertThat(item.getClinicalUom()).isEqualTo("ML");
        assertThat(item.needsQuantityConfirmation()).isFalse();
        assertThat(item.isMeasuredRoundedUp()).isTrue();
        assertThat(item.getQuantityCalculationNote())
                .contains("105 ml").contains("2 sealed").contains("95 ml over");
    }

    @Test
    @DisplayName("an exact multiple needs no round-up: 100 ml against a 100 ml bottle is 1 bottle, not flagged")
    void resolveMeasuredEmrQuantityDoesNotFlagAnExactMultiple() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Melgain",
                "med_1", null, 100, "5ml-5ml", "10 days", null);

        item.resolveMeasuredEmrQuantity(syrup(100), 100);

        assertThat(item.getRoundedPackCount()).isEqualTo(1);
        assertThat(item.getQuantity()).isEqualTo(100);
        assertThat(item.isMeasuredRoundedUp()).isFalse();
    }

    @Test
    @DisplayName("an effective pack size from a pharmacy override (catalogue still null) also rounds the clinic volume up")
    void resolveMeasuredEmrQuantityRespectsAnOverridePackSize() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Melgain",
                "med_1", null, 30, "3ml-0-3ml", "5 days", null);

        item.resolveMeasuredEmrQuantity(syrup(null), 100);

        assertThat(item.getRoundedPackCount()).as("ceil(30 / 100)").isEqualTo(1);
        assertThat(item.getQuantity()).as("one whole 100 ml bottle").isEqualTo(100);
        assertThat(item.needsQuantityConfirmation()).isFalse();
    }

    @Test
    @DisplayName("a countable (tablet) medicine is never affected — its quantity was never ambiguous")
    void resolveMeasuredEmrQuantityIgnoresCountableMedicines() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Azithromycin 500",
                "med_1", null, 15, "1-0-0", "5 days", null);

        item.resolveMeasuredEmrQuantity(tablet(null), null);

        assertThat(item.getQuantity()).isEqualTo(15);
        assertThat(item.needsQuantityConfirmation()).isFalse();
        assertThat(item.getClinicalUom()).isNull();
        assertThat(item.getQuantityCalculationNote()).isNull();
    }

    @Test
    @DisplayName("a non-EMR line (typed into the native prescription form) is never second-guessed")
    void resolveMeasuredEmrQuantityIgnoresNonEmrLines() {
        PrescriptionItem item = PrescriptionItem.create("ph_1", "rx_1", "Melgain", "med_1",
                null, 2, "3ml-0-3ml", "5 days", null);

        item.resolveMeasuredEmrQuantity(syrup(null), null);

        assertThat(item.getQuantity()).isEqualTo(2);
        assertThat(item.needsQuantityConfirmation()).isFalse();
    }

    @Test
    @DisplayName("a line that already needs a quantity is left for the calculator / pharmacist, not touched here")
    void resolveMeasuredEmrQuantityIsANoOpForAnAlreadyUnconfirmedLine() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Melgain",
                "med_1", null, 0, "3ml-0-3ml", "5 days", null);

        item.resolveMeasuredEmrQuantity(syrup(null), null);

        assertThat(item.getQuantity()).isZero();
        assertThat(item.getQuantityCalculationNote()).isNull();
    }

    @Test
    @DisplayName("confirming the quantity afterwards clears the deferral note and records the pharmacist's pack count")
    void confirmingAfterDeferralClearsTheNote() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Melgain",
                "med_1", null, 30, "3ml-0-3ml", "5 days", null);
        item.resolveMeasuredEmrQuantity(syrup(null), null);

        item.confirmQuantity(1);

        assertThat(item.getQuantity()).isEqualTo(1);
        assertThat(item.getRoundedPackCount()).as("the pharmacist entered a sealed-pack count").isEqualTo(1);
        assertThat(item.needsQuantityConfirmation()).isFalse();
        assertThat(item.getQuantityCalculationNote()).isNull();
    }

    @Test
    @DisplayName("an EMR amendment clears the previous calculation state — the caller re-derives it from the new data")
    void applyEmrAmendmentClearsThePreviousCalculationState() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Azithromycin 500",
                "med_1", null, 0, "1-0-1", "6 days", null);
        item.calculateQuantityIfMissing(tablet(10));
        assertThat(item.isQuantityAutoCalculated()).isTrue();

        // The clinic re-pushed this line with a different dosage; applyEmrAmendment overwrites
        // the fields but is never itself responsible for recalculating — that is the caller's
        // job (see EmrIntegrationService.applyAmendment), same division of labour as ingest.
        item.applyEmrAmendment("Azithromycin 500", "med_1", null, 0, "1-1-1", "3 days", null);

        assertThat(item.isQuantityAutoCalculated())
                .as("the OLD calculation no longer describes this line's new dosage")
                .isFalse();
        assertThat(item.getQuantityCalculationNote()).isNull();
        assertThat(item.needsQuantityConfirmation())
                .as("quantity was reset to the amendment's own 0 and not yet recalculated")
                .isTrue();
    }
}
