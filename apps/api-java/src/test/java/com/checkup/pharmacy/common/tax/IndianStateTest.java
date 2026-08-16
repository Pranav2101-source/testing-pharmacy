package com.checkup.pharmacy.common.tax;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The state list underpins a tax decision, so its edges are pinned rather than assumed.
 *
 * <p>Every case here comes from real data. A live supplier record held {@code "cjd9949"} as a
 * state; another pharmacy had {@code "karnataka"} beside a GSTIN whose code said Chhattisgarh,
 * and that GSTIN was eighteen characters long.
 */
class IndianStateTest {

    @Test
    @DisplayName("a GSTIN's first two digits give its state")
    void resolvesStateFromGstin() {
        assertThat(IndianState.fromGstin("33ABCDE1234F1Z5")).contains(IndianState.TAMIL_NADU);
        assertThat(IndianState.fromGstin("27AAAAA0000A1Z5")).contains(IndianState.MAHARASHTRA);
        assertThat(IndianState.fromGstin("29BBBBB1111B1Z9")).contains(IndianState.KARNATAKA);
    }

    @Test
    @DisplayName("a malformed GSTIN yields no state rather than a guess")
    void refusesToGuessFromMalformedGstin() {
        // 18 characters — a real value from the live pharmacies table. Taking the first two
        // digits anyway would launder bad input into an IGST-versus-CGST decision.
        assertThat(IndianState.fromGstin("22AAAAA89070211131")).isEmpty();
        assertThat(IndianState.fromGstin("")).isEmpty();
        assertThat(IndianState.fromGstin(null)).isEmpty();
        assertThat(IndianState.fromGstin("33ABC")).isEmpty();
    }

    @Test
    @DisplayName("an unassigned state code resolves to nothing")
    void unassignedCodeIsNotAState() {
        // 25 was Daman and Diu before the 2020 merger into 26 and is no longer issued.
        assertThat(IndianState.fromGstin("25AAAAA0000A1Z5")).isEmpty();
        assertThat(IndianState.fromGstin("99AAAAA0000A1Z5")).isEmpty();
    }

    @Test
    @DisplayName("stored names resolve regardless of case, padding or separators")
    void resolvesStoredNamesTolerantly() {
        // Rows written before the list existed hold lowercase values.
        assertThat(IndianState.fromName("karnataka")).contains(IndianState.KARNATAKA);
        assertThat(IndianState.fromName("  Tamil Nadu  ")).contains(IndianState.TAMIL_NADU);
        assertThat(IndianState.fromName("TAMIL NADU")).contains(IndianState.TAMIL_NADU);
    }

    /**
     * These used to be rejected, and rejecting them had a price.
     *
     * <p>A separator is not a different name. When "Tamilnadu" failed to resolve, the
     * inter-state comparison fell through to a raw string compare, so a pharmacy in
     * "Tamil Nadu" buying from a supplier recorded as "Tamilnadu" was charged IGST on a
     * LOCAL purchase — and the GSTR-3B sheet then flagged that same receipt as misclassified.
     * One typo produced a wrong tax head and an accusation that the tax head was wrong.
     *
     * <p>See {@code TaxJurisdiction.canonicalKey} for the exact normalisation, which the
     * misclassification SQL mirrors.
     */
    @Test
    @DisplayName("a name written without its separators is the same name")
    void resolvesSeparatorVariants() {
        assertThat(IndianState.fromName("Tamilnadu")).contains(IndianState.TAMIL_NADU);
        assertThat(IndianState.fromName("TamilNadu")).contains(IndianState.TAMIL_NADU);
        assertThat(IndianState.fromName("tamil-nadu")).contains(IndianState.TAMIL_NADU);
        // "&" and "and" are the same word, and both spellings occur in real address data.
        assertThat(IndianState.fromName("Jammu & Kashmir")).contains(IndianState.JAMMU_AND_KASHMIR);
        assertThat(IndianState.fromName("Jammu and Kashmir")).contains(IndianState.JAMMU_AND_KASHMIR);
    }

    @Test
    @DisplayName("junk and abbreviations are still rejected, not approximated")
    void rejectsJunkAndAbbreviations() {
        // The actual value found in a live pharmacy's state column.
        assertThat(IndianState.fromName("cjd9949")).isEmpty();
        // Accepting "TN" would mean two suppliers in one state might not compare equal, which
        // is precisely the failure this type removes. Tolerating separators does NOT open the
        // door to abbreviations: "tn" is not a shorter rendering of "tamilnadu", it is a
        // different string that a human happens to know maps to it.
        assertThat(IndianState.fromName("TN")).isEmpty();
        assertThat(IndianState.fromName("Tamil Nad")).isEmpty();
        assertThat(IndianState.fromName("")).isEmpty();
        assertThat(IndianState.fromName(null)).isEmpty();
    }

    @Test
    @DisplayName("the GSTIN pattern accepts a real one and rejects the live bad one")
    void gstinPatternHoldsTheShape() {
        assertThat("33ABCDE1234F1Z5".matches(IndianState.GSTIN_PATTERN)).isTrue();
        assertThat("22AAAAA89070211131".matches(IndianState.GSTIN_PATTERN)).isFalse();
        assertThat("33abcde1234f1z5".matches(IndianState.GSTIN_PATTERN))
                .as("lowercase is not a GSTIN — callers upper-case before validating")
                .isFalse();
    }

    @Test
    @DisplayName("every state code is unique, so a GSTIN can only resolve one way")
    void codesAreUnique() {
        long distinct = java.util.Arrays.stream(IndianState.values())
                .map(IndianState::gstCode).distinct().count();
        assertThat(distinct).isEqualTo(IndianState.values().length);
    }
}
