package com.checkup.pharmacy.common.util;

import com.checkup.pharmacy.common.enums.PackSizeConfidence;
import com.checkup.pharmacy.common.enums.PackSizeSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class PackSizeEvidenceTest {

    private static PackSizeEvidence assess(String baseUnit, String strength, String packSizeText,
                                           Integer upp, boolean confirmed) {
        return PackSizeEvidence.assess("Melgain", baseUnit, strength, packSizeText, upp, confirmed,
                PackSizeSource.CATALOGUE_ADMIN);
    }

    @Test
    @DisplayName("no pack size on record is NULL confidence, not UNVERIFIED")
    void unclassifiedIsNull() {
        PackSizeEvidence e = assess("ML", "5%", "bottle", null, false);
        assertThat(e.confidence()).isNull();
        assertThat(e.source()).isNull();
        assertThat(e.reason()).isNull();
        assertThat(e.isVerified()).isFalse();
        assertThat(e.isDisputed()).isFalse();
    }

    @Test
    @DisplayName("a pack size equal to the SKU's own strength is DISPUTED")
    void strengthMasqueradeIsDisputed() {
        PackSizeEvidence e = assess("ML", "5%", "bottle", 5, false);
        assertThat(e.confidence()).isEqualTo(PackSizeConfidence.DISPUTED);
        assertThat(e.isDisputed()).isTrue();
        assertThat(e.reason()).contains("strength");
    }

    @Test
    @DisplayName("a human tick cannot override a contradiction — that is how a bad datum would launder itself")
    void confirmationDoesNotBeatContradiction() {
        assertThat(assess("ML", "5%", "bottle", 5, true).confidence())
                .isEqualTo(PackSizeConfidence.DISPUTED);
        assertThat(assess("ML", null, null, 1, true).confidence())
                .isEqualTo(PackSizeConfidence.DISPUTED);
    }

    @Test
    @DisplayName("a measured medicine claiming a 1 ml / 1 g sealed pack is DISPUTED")
    void measuredPackOfOneIsDisputed() {
        assertThat(assess("ML", null, null, 1, false).reason()).contains("millilitre");
        assertThat(assess("GM", null, null, 1, false).reason()).contains("gram");
        // A countable medicine sold one at a time is an ordinary thing — an inhaler, a vial.
        assertThat(assess("EACH", null, null, 1, false).confidence())
                .isEqualTo(PackSizeConfidence.UNVERIFIED);
    }

    @Test
    @DisplayName("an explicit physical-pack check is VERIFIED and keeps the caller's source")
    void humanConfirmationIsVerified() {
        PackSizeEvidence e = PackSizeEvidence.assess("Melgain", "ML", "5%", "bottle", 60, true,
                PackSizeSource.PHARMACIST);
        assertThat(e.confidence()).isEqualTo(PackSizeConfidence.VERIFIED);
        assertThat(e.source()).isEqualTo(PackSizeSource.PHARMACIST);
        assertThat(e.isVerified()).isTrue();
    }

    @Test
    @DisplayName("the medicine's own pack-size text agreeing is corroboration enough, and says so in the source")
    void packSizeTextCorroborates() {
        PackSizeEvidence e = assess("ML", "5%", "60 ml bottle", 60, false);
        assertThat(e.confidence()).isEqualTo(PackSizeConfidence.VERIFIED);
        assertThat(e.source()).isEqualTo(PackSizeSource.PACK_SIZE_TEXT);
        assertThat(e.reason()).contains("60 ml bottle");
    }

    @Test
    @DisplayName("a number nothing corroborates is UNVERIFIED — used, but flagged")
    void uncorroboratedIsUnverified() {
        PackSizeEvidence e = assess("ML", "5%", "bottle", 60, false);
        assertThat(e.confidence()).isEqualTo(PackSizeConfidence.UNVERIFIED);
        assertThat(e.source()).isEqualTo(PackSizeSource.CATALOGUE_ADMIN);
        assertThat(e.reason()).contains("physical pack");
    }

    @Test
    @DisplayName("a countable medicine's strip count is assessed the same way")
    void countableMedicinesAreAssessedToo() {
        assertThat(assess("TABLET", "500 mg", "15 tablets", 15, false).confidence())
                .isEqualTo(PackSizeConfidence.UNVERIFIED);
        assertThat(assess("TABLET", "500 mg", "15 tablets", 15, true).confidence())
                .isEqualTo(PackSizeConfidence.VERIFIED);
        // A strip of 500 for a 500 mg tablet is the same mistake in a different field.
        assertThat(assess("TABLET", "500 mg", null, 500, false).confidence())
                .isEqualTo(PackSizeConfidence.DISPUTED);
    }

    @Test
    @DisplayName("the incident, end to end: 5 is refused, 60 is merely unaudited")
    void theMelgainIncident() {
        assertThat(assess("ML", "5%", null, 5, false).isDisputed()).isTrue();
        assertThat(assess("ML", "5%", null, 60, false).confidence())
                .isEqualTo(PackSizeConfidence.UNVERIFIED);
        assertThat(assess("ML", "5%", null, 60, true).confidence())
                .isEqualTo(PackSizeConfidence.VERIFIED);
    }
}
