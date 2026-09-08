package com.checkup.pharmacy.modules.prescription;

import com.checkup.pharmacy.modules.prescription.PrescriptionQuantityCalculator.Reason;
import com.checkup.pharmacy.modules.prescription.PrescriptionQuantityCalculator.Result;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link PrescriptionQuantityCalculator} is pure and has no Spring/DB dependency, so every case
 * here runs as a plain unit test — see the class doc for the safety reasoning each case backs.
 *
 * <p>Every refusal is checked for its {@link Reason} category, not just that it refused —
 * {@link Result#message()} is what a pharmacist actually reads, and a wrong reason attached to
 * a right refusal is still a bug: it tells the pharmacist the wrong thing about their own data.
 */
class PrescriptionQuantityCalculatorTest {

    // ── The four patterns named in the product spec, each against a different duration ──

    @ParameterizedTest(name = "{0} x {1} = {2} units")
    @DisplayName("worked examples: dosing pattern x days")
    @CsvSource({
            "1-0-0, 6 days,  6",
            "1-0-1, 6 days,  12",
            "1-1-1, 6 days,  18",
            "2-0-2, 5 days,  20",
            "1-0-1, 10 days, 20",
            "1-1-1, 3 days,  9",
            "1-0-0, 1 day,   1",
    })
    void wholeCourseIsPerDayDoseTimesDays(String dosage, String duration, int expected) {
        Result result = PrescriptionQuantityCalculator.calculate(dosage, duration, "TABLET");
        assertThat(result.isCalculated()).isTrue();
        assertThat(result.quantity()).isEqualTo(expected);
    }

    @Test
    @DisplayName("a bare number in duration is read as days")
    void bareNumberDurationIsDays() {
        assertThat(PrescriptionQuantityCalculator.calculate("1-0-1", "6", "TABLET").quantity()).isEqualTo(12);
        assertThat(PrescriptionQuantityCalculator.calculate("1-0-1", "5", "CAPSULE").quantity()).isEqualTo(10);
    }

    @Test
    @DisplayName("weeks are converted to days")
    void weeksConvertToDays() {
        assertThat(PrescriptionQuantityCalculator.calculate("1-0-1", "2 weeks", "TABLET").quantity()).isEqualTo(28);
        assertThat(PrescriptionQuantityCalculator.calculate("1-1-1", "1 wk", "TABLET").quantity()).isEqualTo(21);
    }

    @Test
    @DisplayName("a four-slot pattern (QID-style) sums every slot")
    void fourSlotPatternSumsAllSlots() {
        assertThat(PrescriptionQuantityCalculator.calculate("1-1-1-1", "5 days", "TABLET").quantity()).isEqualTo(20);
    }

    @Test
    @DisplayName("free text around the pattern is ignored")
    void surroundingFreeTextIsIgnored() {
        assertThat(PrescriptionQuantityCalculator.calculate("Tab 1-0-1 after food", "6 days", "TABLET").quantity())
                .isEqualTo(12);
    }

    @Test
    @DisplayName("unicode dash variants (en dash, em dash, minus sign) are normalized before matching")
    void unicodeDashVariantsAreNormalized() {
        assertThat(PrescriptionQuantityCalculator.calculate("1–0–1", "6 days", "TABLET").quantity()).isEqualTo(12);
        assertThat(PrescriptionQuantityCalculator.calculate("1—0—1", "6 days", "TABLET").quantity()).isEqualTo(12);
        assertThat(PrescriptionQuantityCalculator.calculate("1−0−1", "6 days", "TABLET").quantity()).isEqualTo(12);
    }

    // ── EACH, TABLET, CAPSULE: the discrete units this is scoped to ──

    @Test
    @DisplayName("TABLET, CAPSULE and EACH all calculate; ML and GM do not")
    void onlyDiscreteBaseUnitsCalculate() {
        assertThat(PrescriptionQuantityCalculator.calculate("1-0-1", "6 days", "TABLET").isCalculated()).isTrue();
        assertThat(PrescriptionQuantityCalculator.calculate("1-0-1", "6 days", "CAPSULE").isCalculated()).isTrue();
        assertThat(PrescriptionQuantityCalculator.calculate("1-0-1", "6 days", "EACH").isCalculated()).isTrue();

        Result ml = PrescriptionQuantityCalculator.calculate("1-0-1", "6 days", "ML");
        assertThat(ml.isCalculated()).isFalse();
        assertThat(ml.reason()).isEqualTo(Reason.NOT_COUNTABLE_UNIT);
        assertThat(ml.message()).containsIgnoringCase("millilitres");

        Result gm = PrescriptionQuantityCalculator.calculate("1-0-1", "6 days", "GM");
        assertThat(gm.reason()).isEqualTo(Reason.NOT_COUNTABLE_UNIT);

        Result none = PrescriptionQuantityCalculator.calculate("1-0-1", "6 days", null);
        assertThat(none.reason()).isEqualTo(Reason.NOT_COUNTABLE_UNIT);
    }

    @Test
    @DisplayName("base unit is case- and whitespace-insensitive, matching BaseUnits.resolve's own contract")
    void baseUnitIsCaseInsensitive() {
        assertThat(PrescriptionQuantityCalculator.calculate("1-0-1", "6 days", "  tablet ").quantity()).isEqualTo(12);
    }

    @Test
    @DisplayName("isCountable mirrors the same discrete/liquid split")
    void isCountableMirrorsCalculate() {
        assertThat(PrescriptionQuantityCalculator.isCountable("TABLET")).isTrue();
        assertThat(PrescriptionQuantityCalculator.isCountable("CAPSULE")).isTrue();
        assertThat(PrescriptionQuantityCalculator.isCountable("EACH")).isTrue();
        assertThat(PrescriptionQuantityCalculator.isCountable("ML")).isFalse();
        assertThat(PrescriptionQuantityCalculator.isCountable("GM")).isFalse();
        assertThat(PrescriptionQuantityCalculator.isCountable(null)).isFalse();
    }

    // ── Missing / invalid dosage ──

    @Test
    @DisplayName("missing, blank or whitespace-only dosage refuses with a specific reason")
    void missingDosageRefuses() {
        for (String dosage : new String[] { null, "", "   " }) {
            Result result = PrescriptionQuantityCalculator.calculate(dosage, "6 days", "TABLET");
            assertThat(result.isCalculated()).isFalse();
            assertThat(result.reason()).isEqualTo(Reason.DOSAGE_MISSING);
        }
    }

    @Test
    @DisplayName("unsupported dosage formats refuse rather than guess, each with a reason naming the actual text")
    void unsupportedDosageFormatsRefuse() {
        // "As directed" is itself one of the NON_DAILY_QUALIFIER phrases (see that check running
        // before the dosage-pattern parse even starts) — a plain-daily-schedule refusal fits it
        // just as well as a not-a-pattern one, and the qualifier check is what actually runs.
        assertReason("As directed", "6 days", "TABLET", Reason.NON_DAILY_SCHEDULE);
        assertReason("Twice daily", "6 days", "TABLET", Reason.DOSAGE_PATTERN_UNRECOGNIZED);
        assertReason("OD", "6 days", "TABLET", Reason.DOSAGE_PATTERN_UNRECOGNIZED);
        assertReason("BD", "6 days", "TABLET", Reason.DOSAGE_PATTERN_UNRECOGNIZED);
        // A fractional dose needs a rounding decision, not an automatic one.
        assertReason("1/2-0-1/2", "6 days", "TABLET", Reason.DOSAGE_PATTERN_UNRECOGNIZED);
        // A liquid dose in ml is not a tablet-slot pattern, even for a (mislabelled) TABLET row.
        assertReason("10ml-0-10ml", "6 days", "TABLET", Reason.DOSAGE_PATTERN_UNRECOGNIZED);
    }

    @Test
    @DisplayName("two dosing patterns in one string (a taper) is ambiguous, not the first pattern found")
    void twoPatternsIsAmbiguous() {
        assertReason("1-0-1 then 1-0-0", "6 days", "TABLET", Reason.DOSAGE_PATTERN_AMBIGUOUS);
    }

    @Test
    @DisplayName("an all-zero pattern means nothing is taken, not a zero-quantity course")
    void allZeroPatternRefuses() {
        assertReason("0-0-0", "6 days", "TABLET", Reason.DOSAGE_PATTERN_AMBIGUOUS);
    }

    @Test
    @DisplayName("a single number with no dashes is not a dosing pattern")
    void singleNumberIsNotADosingPattern() {
        assertReason("1", "6 days", "TABLET", Reason.DOSAGE_PATTERN_UNRECOGNIZED);
    }

    @Test
    @DisplayName("a five-slot pattern is refused outright, not silently truncated to its first four slots")
    void fiveSlotPatternIsRefusedNotTruncated() {
        // Regression: an earlier version of the boundary regex stopped consuming after 4 slots
        // and would have matched "1-1-1-1" out of this, silently dropping the 5th "-1" and
        // reporting 4/day instead of refusing. The whole chain must be recognized as one
        // pattern and rejected for having too many slots.
        assertReason("1-1-1-1-1", "5 days", "TABLET", Reason.DOSAGE_PATTERN_AMBIGUOUS);
    }

    // ── Missing / invalid duration ──

    @Test
    @DisplayName("missing, blank or whitespace-only duration refuses with a specific reason")
    void missingDurationRefuses() {
        for (String duration : new String[] { null, "", "   " }) {
            Result result = PrescriptionQuantityCalculator.calculate("1-0-1", duration, "TABLET");
            assertThat(result.isCalculated()).isFalse();
            assertThat(result.reason()).isEqualTo(Reason.DURATION_MISSING);
        }
    }

    @Test
    @DisplayName("a duration with no number at all refuses")
    void durationWithNoNumberRefuses() {
        assertReason("1-0-1", "Until finished", "TABLET", Reason.DURATION_UNRECOGNIZED);
    }

    @Test
    @DisplayName("a duration range is ambiguous, not its first number")
    void durationRangeIsAmbiguous() {
        assertReason("1-0-1", "3 to 5 days", "TABLET", Reason.DURATION_AMBIGUOUS);
    }

    @Test
    @DisplayName("a duration in months refuses — 28, 30 and 31 days are three different courses")
    void durationInMonthsRefuses() {
        assertReason("1-0-1", "1 month", "TABLET", Reason.DURATION_AMBIGUOUS);
        assertReason("1-0-1", "3 months", "TABLET", Reason.DURATION_AMBIGUOUS);
    }

    @Test
    @DisplayName("a zero-day duration refuses, same as a zero-dose pattern")
    void zeroDayDurationRefuses() {
        assertReason("1-0-1", "0 days", "TABLET", Reason.DURATION_UNRECOGNIZED);
    }

    // ── Non-daily qualifiers: the pattern parses cleanly and would still be wrong ──

    @Test
    @DisplayName("SOS/PRN/alternate-day qualifiers refuse even though the pattern itself parses")
    void nonDailyQualifiersRefuseDespiteAValidPattern() {
        assertReason("1-0-1 SOS", "6 days", "TABLET", Reason.NON_DAILY_SCHEDULE);
        assertReason("1-0-1", "6 days alternate days", "TABLET", Reason.NON_DAILY_SCHEDULE);
        assertReason("1-0-1", "6 days PRN", "TABLET", Reason.NON_DAILY_SCHEDULE);
        assertReason("1-0-0 as needed", "10 days", "TABLET", Reason.NON_DAILY_SCHEDULE);
    }

    // ── Sanity ceilings — a wildly-off number should never be silently produced ──

    @Test
    @DisplayName("an implausibly large course (bad data, not a real prescription) refuses rather than compute a huge number")
    void implausiblyLargeCourseRefuses() {
        // 20 units/day slot rejected outright.
        assertReason("25-0-0", "6 days", "TABLET", Reason.DOSAGE_PATTERN_AMBIGUOUS);
        // A duration past the sanity ceiling.
        assertReason("1-0-1", "400 days", "TABLET", Reason.DURATION_UNRECOGNIZED);
        // A technically-parseable total that is still absurd for one course.
        assertReason("20-20-20", "180 days", "TABLET", Reason.RESULT_IMPLAUSIBLE);
    }

    @Test
    @DisplayName("a plausible long-course total right at the edge still calculates")
    void plausibleLongCourseStillCalculates() {
        assertThat(PrescriptionQuantityCalculator.calculate("1-0-1", "180 days", "TABLET").quantity())
                .isEqualTo(360);
    }

    private static void assertReason(String dosage, String duration, String baseUnit, Reason expected) {
        Result result = PrescriptionQuantityCalculator.calculate(dosage, duration, baseUnit);
        assertThat(result.isCalculated())
                .as("expected %s to refuse to calculate", result)
                .isFalse();
        assertThat(result.reason()).isEqualTo(expected);
        assertThat(result.message()).isNotBlank();
    }
}
