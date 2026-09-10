package com.checkup.pharmacy.common.util;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class PackSizeGuardTest {

    @Test
    @DisplayName("parseMeasuredSize reads ml / g out of free text, ignores mg / mcg strengths")
    void parseMeasuredSize() {
        assertThat(PackSizeGuard.parseMeasuredSize("100ml")).isEqualTo(100);
        assertThat(PackSizeGuard.parseMeasuredSize("100 ml bottle")).isEqualTo(100);
        assertThat(PackSizeGuard.parseMeasuredSize("1 x 60ml")).isEqualTo(60);
        assertThat(PackSizeGuard.parseMeasuredSize("15 gm tube")).isEqualTo(15);
        assertThat(PackSizeGuard.parseMeasuredSize("500mg")).isNull();
        assertThat(PackSizeGuard.parseMeasuredSize("650 mg")).isNull();
        assertThat(PackSizeGuard.parseMeasuredSize("15 tablets")).isNull();
        assertThat(PackSizeGuard.parseMeasuredSize(null)).isNull();
        assertThat(PackSizeGuard.parseMeasuredSize("1ml")).isNull();
    }

    @Test
    @DisplayName("contradictoryPackSize flags a measured SKU whose text and unitsPerPack disagree")
    void contradictoryPackSizeFlags() {
        assertThat(PackSizeGuard.contradictoryPackSize("ML", "200ml bottle", 100))
                .contains("200 ml").contains("100");
        assertThat(PackSizeGuard.contradictoryPackSize("GM", "30 g", 15)).isNotNull();
    }

    @Test
    @DisplayName("contradictoryPackSize is silent when they agree / either is missing / not measured")
    void contradictoryPackSizeQuiet() {
        assertThat(PackSizeGuard.contradictoryPackSize("ML", "100ml", 100)).isNull();
        assertThat(PackSizeGuard.contradictoryPackSize("ML", null, 100)).isNull();
        assertThat(PackSizeGuard.contradictoryPackSize("ML", "100ml", null)).isNull();
        assertThat(PackSizeGuard.contradictoryPackSize("TABLET", "10 tablets", 15)).isNull();
        assertThat(PackSizeGuard.contradictoryPackSize("ML", "10 tablets", 100)).isNull();
    }

    @Test
    @DisplayName("strengthMasqueradingAsPackSize catches the Melgain case — a 5% strength entered as a 5 ml pack")
    void strengthMasqueradingCatchesPercent() {
        String msg = PackSizeGuard.strengthMasqueradingAsPackSize("Melgain", "5%", "bottle", 5);
        assertThat(msg).isNotNull().contains("Melgain").contains("5%").contains("strength");
    }

    @Test
    @DisplayName("strengthMasqueradingAsPackSize covers the other units a strength is written in")
    void strengthMasqueradingCoversUnits() {
        assertThat(PackSizeGuard.strengthMasqueradingAsPackSize("A", "500 mg", null, 500)).isNotNull();
        assertThat(PackSizeGuard.strengthMasqueradingAsPackSize("A", "40 mcg", null, 40)).isNotNull();
        assertThat(PackSizeGuard.strengthMasqueradingAsPackSize("A", "100 IU", null, 100)).isNotNull();
        assertThat(PackSizeGuard.strengthMasqueradingAsPackSize("A", "2 w/v", null, 2)).isNotNull();
        assertThat(PackSizeGuard.strengthMasqueradingAsPackSize("A", "5 mg/ml", null, 5))
                .isNotNull().contains("mg/ml");
        // "5.0%" and 5 are the same figure — BigDecimal scale must not hide the match.
        assertThat(PackSizeGuard.strengthMasqueradingAsPackSize("A", "5.0%", null, 5)).isNotNull();
        // The claim can also sit in the free-text pack size rather than the strength field.
        assertThat(PackSizeGuard.strengthMasqueradingAsPackSize("A", null, "5% w/v lotion", 5)).isNotNull();
    }

    @Test
    @DisplayName("strengthMasqueradingAsPackSize stays quiet unless the two numbers actually coincide")
    void strengthMasqueradingQuiet() {
        // The real Melgain: a 60 ml bottle of a 5% lotion. 60 appears nowhere as a strength.
        assertThat(PackSizeGuard.strengthMasqueradingAsPackSize("Melgain", "5%", "60ml bottle", 60)).isNull();
        assertThat(PackSizeGuard.strengthMasqueradingAsPackSize("A", "500 mg", "10 tablets", 10)).isNull();
        assertThat(PackSizeGuard.strengthMasqueradingAsPackSize("A", null, null, 10)).isNull();
        assertThat(PackSizeGuard.strengthMasqueradingAsPackSize("A", "5%", null, null)).isNull();
        // A real volume in the pack-size text is not a strength, however much it looks like one.
        assertThat(PackSizeGuard.strengthMasqueradingAsPackSize("A", null, "100 ml", 100)).isNull();
    }

    @Test
    @DisplayName("differentPackSizeWarning warns when a new batch's MRP is roughly double / half the existing stock")
    void differentPackSizeWarningWarns() {
        assertThat(PackSizeGuard.differentPackSizeWarning("Benadryl Syrup", "bottle",
                new BigDecimal("190"), List.of(new BigDecimal("95"), new BigDecimal("105"))))
                .contains("Benadryl Syrup").contains("bottle size");
        assertThat(PackSizeGuard.differentPackSizeWarning("Benadryl Syrup", "bottle",
                new BigDecimal("55"), List.of(new BigDecimal("110"), new BigDecimal("112"))))
                .isNotNull();
    }

    @Test
    @DisplayName("differentPackSizeWarning is silent for a normal price gap and when there is nothing to compare")
    void differentPackSizeWarningQuiet() {
        assertThat(PackSizeGuard.differentPackSizeWarning("X", "bottle",
                new BigDecimal("118"), List.of(new BigDecimal("100"), new BigDecimal("110")))).isNull();
        assertThat(PackSizeGuard.differentPackSizeWarning("X", "bottle",
                new BigDecimal("190"), List.of())).isNull();
        assertThat(PackSizeGuard.differentPackSizeWarning("X", "bottle", null,
                List.of(new BigDecimal("100")))).isNull();
    }
}
