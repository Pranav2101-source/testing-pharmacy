package com.checkup.pharmacy.modules.medicine;

import com.checkup.pharmacy.common.enums.PackSizeConfidence;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The COALESCE(override, catalogue) pack multiple, in one place.
 *
 * <p>Every caller that converts sealed packs to pieces must resolve the pharmacy's own
 * override BEFORE the shared catalogue, because the catalogue is platform-admin-owned and
 * an override row is the only way a pharmacy can classify a pack size for itself. Two
 * callers did not — {@code PrescriptionService#stockCheck} and the EMR medicine-match
 * preview — and reported the same shelf an order of magnitude apart from the billing cart.
 */
class PharmacyMedicineOverrideUnitsTest {

    private static Medicine medicine(Integer unitsPerPack) {
        Medicine m = new Medicine();
        set(m, "unitsPerPack", unitsPerPack);
        return m;
    }

    private static PharmacyMedicineOverride override(Integer unitsPerPack) {
        PharmacyMedicineOverride o = PharmacyMedicineOverride.create("ph-1", "med-1");
        o.applyLoosePos(true, unitsPerPack);
        return o;
    }

    /** These entities are JPA-managed with no public setter for the field under test. */
    private static void set(Object target, String field, Object value) {
        try {
            Field f = target.getClass().getDeclaredField(field);
            f.setAccessible(true);
            f.set(target, value);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    @DisplayName("the pharmacy's own pack size wins over the catalogue's")
    void overrideWins() {
        assertThat(PharmacyMedicineOverride.effectiveUnitsPerPack(override(10), medicine(15))).isEqualTo(10);
    }

    @Test
    @DisplayName("the catalogue is used when the pharmacy has no override row at all")
    void catalogueWhenNoOverride() {
        assertThat(PharmacyMedicineOverride.effectiveUnitsPerPack(null, medicine(15))).isEqualTo(15);
    }

    @Test
    @DisplayName("an override row that sets no pack size falls through to the catalogue")
    void overrideWithoutPackSizeFallsThrough() {
        // The common shape: a pharmacy toggled loose selling but left the pack size to the
        // catalogue. Treating the row's presence as an answer would zero out a real pack size.
        assertThat(PharmacyMedicineOverride.effectiveUnitsPerPack(override(null), medicine(15))).isEqualTo(15);
    }

    @Test
    @DisplayName("null when neither has classified the medicine — NOT 1")
    void unclassifiedIsNull() {
        // The distinction matters: null means "cannot be sold loose", whereas 1 would mean
        // "one piece per pack", which is a claim nobody made. DispensingService relies on it.
        assertThat(PharmacyMedicineOverride.effectiveUnitsPerPack(null, medicine(null))).isNull();
        assertThat(PharmacyMedicineOverride.effectiveUnitsPerPack(override(null), medicine(null))).isNull();
    }

    @Test
    @DisplayName("a null medicine yields the override's own value, or null")
    void nullMedicine() {
        assertThat(PharmacyMedicineOverride.effectiveUnitsPerPack(override(10), null)).isEqualTo(10);
        assertThat(PharmacyMedicineOverride.effectiveUnitsPerPack(null, null)).isNull();
    }

    @Test
    @DisplayName("the piece-count multiple floors an unclassified medicine at 1")
    void packMultipleFloorsAtOne() {
        assertThat(PharmacyMedicineOverride.effectivePackMultiple(null, medicine(null))).isEqualTo(1);
        assertThat(PharmacyMedicineOverride.effectivePackMultiple(null, null)).isEqualTo(1);
        assertThat(PharmacyMedicineOverride.effectivePackMultiple(override(10), medicine(null))).isEqualTo(10);
        assertThat(PharmacyMedicineOverride.effectivePackMultiple(null, medicine(15))).isEqualTo(15);
    }

    @Test
    @DisplayName("a nonsensical zero or negative pack size counts as unclassified")
    void nonPositiveTreatedAsOne() {
        assertThat(PharmacyMedicineOverride.effectivePackMultiple(null, medicine(0))).isEqualTo(1);
        assertThat(PharmacyMedicineOverride.effectivePackMultiple(null, medicine(-5))).isEqualTo(1);
    }

    // ── effectivePackSizeConfidence — the trust state of the number billing divides by ──────

    private static Medicine medicine(Integer unitsPerPack, PackSizeConfidence confidence) {
        Medicine m = medicine(unitsPerPack);
        set(m, "packSizeConfidence", confidence);
        return m;
    }

    private static PharmacyMedicineOverride confirmed(Integer overrideUpp, int confirmedUpp) {
        PharmacyMedicineOverride o = override(overrideUpp);
        o.confirmPackSize(confirmedUpp, Instant.now());
        return o;
    }

    @Test
    @DisplayName("the reported gap: confirming the CATALOGUE's number here clears the badge for this pharmacy")
    void confirmingTheCatalogueNumberVerifiesItHere() {
        // The verify dialog sends no pack size when the pharmacist confirms the catalogue's own
        // value (so later catalogue corrections still reach them) — the confirmation alone must
        // be enough, or the chip comes straight back after they have checked the bottle.
        Medicine m = medicine(60, PackSizeConfidence.UNVERIFIED);
        assertThat(PharmacyMedicineOverride.effectivePackSizeConfidence(confirmed(null, 60), m))
                .isEqualTo(PackSizeConfidence.VERIFIED);
    }

    @Test
    @DisplayName("confirming this pharmacy's own override number verifies it here")
    void confirmingTheOverrideNumberVerifiesIt() {
        Medicine m = medicine(5, PackSizeConfidence.DISPUTED);
        assertThat(PharmacyMedicineOverride.effectivePackSizeConfidence(confirmed(60, 60), m))
                .isEqualTo(PackSizeConfidence.VERIFIED);
    }

    @Test
    @DisplayName("an old confirmation of a DIFFERENT number vouches for nothing — the looseConfirmedAt trap")
    void aConfirmationOfAnotherNumberDoesNotCarryOver() {
        // Confirmed 10 once, the override has since moved to 60 without a confirmation.
        PharmacyMedicineOverride o = confirmed(10, 10);
        o.applyLoosePos(false, 60);
        assertThat(PharmacyMedicineOverride.effectivePackSizeConfidence(o, medicine(null, null)))
                .isEqualTo(PackSizeConfidence.UNVERIFIED);
    }

    @Test
    @DisplayName("a catalogue correction after the confirmation brings the catalogue's state back")
    void aCatalogueChangeOutdatesTheConfirmation() {
        Medicine corrected = medicine(100, PackSizeConfidence.UNVERIFIED);
        assertThat(PharmacyMedicineOverride.effectivePackSizeConfidence(confirmed(null, 60), corrected))
                .isEqualTo(PackSizeConfidence.UNVERIFIED);
    }

    @Test
    @DisplayName("an unconfirmed override number is UNVERIFIED — the catalogue's verdict is about a different number")
    void anUnconfirmedOverrideIgnoresTheCatalogueVerdict() {
        // Neither VERIFIED nor DISPUTED on the catalogue says anything about 30.
        assertThat(PharmacyMedicineOverride.effectivePackSizeConfidence(override(30),
                medicine(60, PackSizeConfidence.VERIFIED))).isEqualTo(PackSizeConfidence.UNVERIFIED);
        assertThat(PharmacyMedicineOverride.effectivePackSizeConfidence(override(30),
                medicine(5, PackSizeConfidence.DISPUTED))).isEqualTo(PackSizeConfidence.UNVERIFIED);
    }

    @Test
    @DisplayName("with no confirmation here, the catalogue's number carries the catalogue's state — quorum dispute included")
    void catalogueStateWhenTheNumberIsTheCatalogues() {
        assertThat(PharmacyMedicineOverride.effectivePackSizeConfidence(null,
                medicine(5, PackSizeConfidence.DISPUTED))).isEqualTo(PackSizeConfidence.DISPUTED);
        assertThat(PharmacyMedicineOverride.effectivePackSizeConfidence(override(null),
                medicine(60, PackSizeConfidence.VERIFIED))).isEqualTo(PackSizeConfidence.VERIFIED);
        // An override that happens to equal the catalogue shares its verdict — same number.
        assertThat(PharmacyMedicineOverride.effectivePackSizeConfidence(override(60),
                medicine(60, PackSizeConfidence.VERIFIED))).isEqualTo(PackSizeConfidence.VERIFIED);
    }

    @Test
    @DisplayName("null when nothing has classified the pack size — distinct from UNVERIFIED")
    void unclassifiedHasNoConfidence() {
        assertThat(PharmacyMedicineOverride.effectivePackSizeConfidence(null, medicine(null, null))).isNull();
        assertThat(PharmacyMedicineOverride.effectivePackSizeConfidence(override(null), null)).isNull();
    }
}
