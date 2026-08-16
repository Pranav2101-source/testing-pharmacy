package com.checkup.pharmacy.common.tax;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The single decision behind every IGST-versus-CGST+SGST split in the system.
 *
 * <p>Four call sites used to answer this with {@code equalsIgnoreCase} on two free-text
 * columns — a sale, a goods receipt, a debit note, and the GSTR-3B check that audits the
 * other three. Tested hard because a wrong answer here is silent: the document still adds
 * up, only the tax head is wrong, and that surfaces months later as a return that will not
 * reconcile.
 */
class TaxJurisdictionTest {

    @Test
    @DisplayName("different states attract IGST, the same state does not")
    void theBasicDecision() {
        assertThat(TaxJurisdiction.isInterstate("Tamil Nadu", "Maharashtra")).isTrue();
        assertThat(TaxJurisdiction.isInterstate("Tamil Nadu", "Tamil Nadu")).isFalse();
    }

    /**
     * The bug this class was extracted to fix. "Tamilnadu" and "Tamil Nadu" are one state,
     * and comparing them as raw text said otherwise — charging IGST on a local purchase and
     * then flagging that same receipt on the 3B sheet as misclassified.
     */
    @Test
    @DisplayName("one state spelled two ways is still one state")
    void spellingVariantsAreNotStateLines() {
        assertThat(TaxJurisdiction.isInterstate("Tamil Nadu", "Tamilnadu")).isFalse();
        assertThat(TaxJurisdiction.isInterstate("Tamil Nadu", "TAMILNADU")).isFalse();
        assertThat(TaxJurisdiction.isInterstate("tamil-nadu", "Tamil Nadu")).isFalse();
        assertThat(TaxJurisdiction.isInterstate("Jammu & Kashmir", "Jammu and Kashmir")).isFalse();
        assertThat(TaxJurisdiction.isInterstate("  Karnataka  ", "karnataka")).isFalse();
    }

    /**
     * Fails SAFE, and the direction matters. Treating an unknown state as inter-state would
     * move a whole pharmacy's input credit into the IGST column the moment somebody left the
     * settings page half-filled — far worse than leaving the handful of genuinely inter-state
     * ones as they are recorded, which the 3B sheet flags separately.
     */
    @Test
    @DisplayName("an unknown state on either side reads as local, never as inter-state")
    void unknownFailsToLocal() {
        assertThat(TaxJurisdiction.isInterstate(null, "Maharashtra")).isFalse();
        assertThat(TaxJurisdiction.isInterstate("", "Maharashtra")).isFalse();
        assertThat(TaxJurisdiction.isInterstate("   ", "Maharashtra")).isFalse();
        assertThat(TaxJurisdiction.isInterstate("Tamil Nadu", null)).isFalse();
        assertThat(TaxJurisdiction.isInterstate("Tamil Nadu", "")).isFalse();
        assertThat(TaxJurisdiction.isInterstate("Tamil Nadu", "   ")).isFalse();
    }

    /**
     * A value neither side can resolve is still compared, because two records holding the
     * same junk are at least holding the SAME junk — and declaring that inter-state would
     * invent a tax liability out of a data-entry habit.
     */
    @Test
    @DisplayName("unrecognised values still compare equal to themselves")
    void unrecognisedValuesCompareByKey() {
        // The actual value found in a live pharmacy's state column.
        assertThat(TaxJurisdiction.isInterstate("cjd9949", "cjd9949")).isFalse();
        assertThat(TaxJurisdiction.isInterstate("cjd9949", "CJD 9949")).isFalse();
        assertThat(TaxJurisdiction.isInterstate("cjd9949", "Maharashtra")).isTrue();
    }

    @Test
    @DisplayName("an abbreviation is not treated as the state it stands for")
    void abbreviationsAreNotResolved() {
        // Consistent with IndianState.fromName: accepting "TN" here would mean accepting that
        // two suppliers in one state might not compare equal in some other code path.
        assertThat(TaxJurisdiction.isInterstate("Tamil Nadu", "TN")).isTrue();
    }

    @Test
    @DisplayName("the canonical key strips separators without collapsing distinct names")
    void canonicalKeyIsNarrow() {
        assertThat(TaxJurisdiction.canonicalKey("Tamil Nadu")).isEqualTo("tamilnadu");
        assertThat(TaxJurisdiction.canonicalKey("Jammu & Kashmir")).isEqualTo("jammuandkashmir");
        assertThat(TaxJurisdiction.canonicalKey(null)).isEmpty();
        // Two genuinely different states must never share a key.
        assertThat(TaxJurisdiction.canonicalKey("Punjab"))
                .isNotEqualTo(TaxJurisdiction.canonicalKey("Haryana"));
    }

    /**
     * Guards the contract the misclassification SQL depends on: every state in the list has a
     * key of its own. If two ever collided, purchases from one would silently be treated as
     * local to the other.
     */
    @Test
    @DisplayName("no two states share a canonical key")
    void everyStateKeyIsUnique() {
        long distinct = java.util.Arrays.stream(IndianState.values())
                .map(s -> TaxJurisdiction.canonicalKey(s.displayName()))
                .distinct()
                .count();
        assertThat(distinct).isEqualTo(IndianState.values().length);
    }
}
