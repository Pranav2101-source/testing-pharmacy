package com.checkup.pharmacy.common.util;

import com.checkup.pharmacy.common.util.PackSizeQuorum.Observation;
import com.checkup.pharmacy.common.util.PackSizeQuorum.Verdict;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class PackSizeQuorumTest {

    private static Observation at(String pharmacy, int implied) {
        return new Observation(pharmacy, implied);
    }

    @Test
    @DisplayName("one pharmacist disagreeing is an anecdote, not evidence")
    void singleSignalIsNotAQuorum() {
        Verdict v = PackSizeQuorum.evaluate(List.of(at("p1", 40)), 5);
        assertThat(v.reached()).isFalse();
        assertThat(v.summary()).contains("Not enough signals");
    }

    @Test
    @DisplayName("three signals from ONE pharmacy are still one shop's habit")
    void oneePharmacyCannotReachQuorumAlone() {
        Verdict v = PackSizeQuorum.evaluate(
                List.of(at("p1", 40), at("p1", 45), at("p1", 38)), 5);
        assertThat(v.reached()).isFalse();
        assertThat(v.summary()).contains("one pharmacy");
    }

    @Test
    @DisplayName("the Melgain case: three pharmacists in two shops agreeing that 5 ml is far too small")
    void quorumReachedAcrossPharmacies() {
        Verdict v = PackSizeQuorum.evaluate(
                List.of(at("p1", 40), at("p2", 50), at("p2", 45)), 5);

        assertThat(v.reached()).isTrue();
        assertThat(v.signalCount()).isEqualTo(3);
        assertThat(v.pharmacyCount()).isEqualTo(2);
        assertThat(v.impliedPackSize()).isEqualTo(45);   // the median, not the mean
        assertThat(v.summary()).contains("larger").contains("lower bound");
    }

    @Test
    @DisplayName("pharmacists overriding for unrelated reasons scatter, and scatter is not agreement")
    void scatteredSignalsDoNotAgree() {
        // A short shelf, a patient wanting less, a split course — nothing about the pack.
        Verdict v = PackSizeQuorum.evaluate(
                List.of(at("p1", 8), at("p2", 90), at("p3", 300)), 5);
        assertThat(v.reached()).isFalse();
        assertThat(v.summary()).contains("disagree");
    }

    @Test
    @DisplayName("an outlier neither creates a quorum nor destroys one — the median holds the cluster")
    void outlierDoesNotDragTheVerdict() {
        Verdict v = PackSizeQuorum.evaluate(
                List.of(at("p1", 60), at("p2", 55), at("p2", 58), at("p3", 5000)), 5);

        assertThat(v.reached()).isTrue();
        // The 5000 is outside the band around the cluster, so it is not counted as agreement.
        assertThat(v.signalCount()).isEqualTo(3);
        assertThat(v.impliedPackSize()).isBetween(55, 60);
    }

    @Test
    @DisplayName("signals that agree with the pack size ALREADY on record are just arithmetic, not a dispute")
    void agreementWithTheCatalogueIsNotADispute() {
        // Three pharmacists rounding a course differently against a perfectly correct 60 ml
        // bottle. Their implied sizes cluster near 60 — which is the catalogue's own number.
        Verdict v = PackSizeQuorum.evaluate(
                List.of(at("p1", 60), at("p2", 55), at("p3", 65)), 60);
        assertThat(v.reached()).isFalse();
        assertThat(v.summary()).contains("already on record");
    }

    @Test
    @DisplayName("a pack size smaller than the catalogue claims is disputed too, and named as such")
    void quorumCanPointDownwardAsWell() {
        Verdict v = PackSizeQuorum.evaluate(
                List.of(at("p1", 30), at("p2", 32), at("p3", 28)), 200);
        assertThat(v.reached()).isTrue();
        assertThat(v.summary()).contains("smaller");
    }

    @Test
    @DisplayName("an unclassified medicine has nothing to dispute — an absence is not a contradiction")
    void noDeclaredPackSizeMeansNothingToDispute() {
        Verdict v = PackSizeQuorum.evaluate(
                List.of(at("p1", 40), at("p2", 50), at("p3", 45)), 0);
        assertThat(v.reached()).isFalse();
        assertThat(v.summary()).contains("No declared pack size");
    }

    @Test
    @DisplayName("unusable signals are discarded rather than counted as agreement")
    void nonPositiveImpliedSizesAreIgnored() {
        Verdict v = PackSizeQuorum.evaluate(
                List.of(at("p1", 40), at("p2", 0), at("p3", -3)), 5);
        assertThat(v.reached()).isFalse();
        assertThat(v.summary()).contains("Not enough usable signals");
    }

    @Test
    @DisplayName("null and empty inputs are a non-verdict, never a crash")
    void handlesNoInput() {
        assertThat(PackSizeQuorum.evaluate(null, 5).reached()).isFalse();
        assertThat(PackSizeQuorum.evaluate(List.of(), 5).reached()).isFalse();
    }

    @Test
    @DisplayName("the verdict never proposes a value to write — only a lower bound, labelled as one")
    void verdictIsEvidenceNotACorrection() {
        // Pharmacists handing one bottle against 40 ml imply "at least 40" for a 60 ml bottle.
        // The number is deliberately short of the truth, and the summary has to say so, or
        // somebody downstream will paste it into unitsPerPack.
        Verdict v = PackSizeQuorum.evaluate(
                List.of(at("p1", 40), at("p2", 40), at("p3", 40)), 5);
        assertThat(v.reached()).isTrue();
        assertThat(v.impliedPackSize()).isEqualTo(40);
        assertThat(v.summary())
                .contains("lower bound")
                .contains("not as a measurement");
    }
}
