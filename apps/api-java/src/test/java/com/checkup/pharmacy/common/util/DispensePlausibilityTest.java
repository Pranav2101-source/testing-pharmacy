package com.checkup.pharmacy.common.util;

import com.checkup.pharmacy.common.util.DispensePlausibility.MeasuredForm;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class DispensePlausibilityTest {

    @Test
    @DisplayName("classify reads the administration route out of the catalogue's free-text form")
    void classifyByForm() {
        assertThat(DispensePlausibility.classify("lotion", "ML")).isEqualTo(MeasuredForm.TOPICAL);
        assertThat(DispensePlausibility.classify("Cream", "GM")).isEqualTo(MeasuredForm.TOPICAL);
        assertThat(DispensePlausibility.classify("ointment", "GM")).isEqualTo(MeasuredForm.TOPICAL);
        assertThat(DispensePlausibility.classify("solution", "ML")).isEqualTo(MeasuredForm.TOPICAL);
        assertThat(DispensePlausibility.classify("eye drops", "ML")).isEqualTo(MeasuredForm.TOPICAL);

        assertThat(DispensePlausibility.classify("syrup", "ML")).isEqualTo(MeasuredForm.ORAL_LIQUID);
        assertThat(DispensePlausibility.classify("Suspension", "ML")).isEqualTo(MeasuredForm.ORAL_LIQUID);
        assertThat(DispensePlausibility.classify("elixir", "ML")).isEqualTo(MeasuredForm.ORAL_LIQUID);
    }

    @Test
    @DisplayName("an ORAL route wins over a topical word in the same string")
    void oralBeatsTopical() {
        // "oral solution" contains "solution"; reading it as a topical would apply the tighter
        // ceiling and hold a perfectly ordinary course.
        assertThat(DispensePlausibility.classify("oral solution", "ML")).isEqualTo(MeasuredForm.ORAL_LIQUID);
        assertThat(DispensePlausibility.classify("Oral Drops", "ML")).isEqualTo(MeasuredForm.ORAL_LIQUID);
    }

    @Test
    @DisplayName("with no usable form, GM is topical and a bare ML stays unknown")
    void classifyFallback() {
        assertThat(DispensePlausibility.classify(null, "GM")).isEqualTo(MeasuredForm.TOPICAL);
        assertThat(DispensePlausibility.classify("", "GM")).isEqualTo(MeasuredForm.TOPICAL);
        // ML covers both a scalp solution and a cough syrup — guessing holds a legitimate line.
        assertThat(DispensePlausibility.classify(null, "ML")).isEqualTo(MeasuredForm.UNKNOWN);
        assertThat(DispensePlausibility.packCeiling(MeasuredForm.UNKNOWN)).isZero();
    }

    @Test
    @DisplayName("the reported Melgain case: 40 ml of a topical against a 5 ml pack size is flagged")
    void flagsTheMelgainCase() {
        String msg = DispensePlausibility.implausiblePackCount(
                "Melgain", "solution", "ML", "Bottle", 8, 40, 5);
        assertThat(msg)
                .isNotNull()
                .contains("Melgain")
                .contains("40 ml")
                .contains("8 sealed bottles")
                .contains("5 ml pack size");
    }

    @Test
    @DisplayName("a plausible course is silent — one or two packs of a topical, up to four of a syrup")
    void quietOnPlausibleCourses() {
        // 40 ml against a real 60 ml bottle: one bottle.
        assertThat(DispensePlausibility.implausiblePackCount(
                "Melgain", "solution", "ML", "Bottle", 1, 40, 60)).isNull();
        // Two tubes of a cream is unusual but real.
        assertThat(DispensePlausibility.implausiblePackCount(
                "Betnovate-N", "cream", "GM", "Tube", 2, 40, 20)).isNull();
        // A paediatric syrup course legitimately runs to four bottles.
        assertThat(DispensePlausibility.implausiblePackCount(
                "Augmentin Syrup", "syrup", "ML", "Bottle", 4, 400, 100)).isNull();
        assertThat(DispensePlausibility.implausiblePackCount(
                "Augmentin Syrup", "syrup", "ML", "Bottle", 5, 500, 100)).isNotNull();
    }

    @Test
    @DisplayName("never judges a countable line, an unknown form, or an unclassified pack size")
    void quietWhenItCannotJudge() {
        // Countable — a 30-strip course is a dispensing decision, not a unit error.
        assertThat(DispensePlausibility.implausiblePackCount(
                "Pantoprazole", "tablet", "TABLET", "Strip", 30, 300, 10)).isNull();
        // Measured but the route is unknown: no ceiling rather than a wrong one.
        assertThat(DispensePlausibility.implausiblePackCount(
                "Unknown Liquid", null, "ML", "Bottle", 9, 90, 10)).isNull();
        // Nothing to divide by.
        assertThat(DispensePlausibility.implausiblePackCount(
                "Melgain", "solution", "ML", "Bottle", 8, 40, 0)).isNull();
        assertThat(DispensePlausibility.implausiblePackCount(
                "Melgain", "solution", "ML", "Bottle", 0, 40, 5)).isNull();
    }

    @Test
    @DisplayName("the message names the divisor, because the pack size is what is usually wrong")
    void messageNamesTheArithmetic() {
        String msg = DispensePlausibility.implausiblePackCount(
                "Clobetasol", "ointment", "GM", "Tube", 6, 90, 15);
        // A pharmacist can only catch a bad pack size if the number is on screen next to the
        // answer it produced — see the class doc.
        assertThat(msg).contains("15 g pack size").contains("6 sealed tubes").contains("2 tubes");
    }
}
