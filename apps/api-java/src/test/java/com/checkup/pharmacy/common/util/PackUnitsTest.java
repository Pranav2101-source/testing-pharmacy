package com.checkup.pharmacy.common.util;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link PackUnits} must stay byte-for-byte in step with {@code sale-unit.ts} in
 * {@code @pharmacy/utils} — the same sale is labelled by this engine and by the web cart.
 */
class PackUnitsTest {

    @Test
    @DisplayName("packUnitLabel prefers a known packaging word, else infers from the base unit")
    void packUnitLabel() {
        assertThat(PackUnits.packUnitLabel("Strip", "TABLET")).isEqualTo("strip");
        assertThat(PackUnits.packUnitLabel("Bottle", "ML")).isEqualTo("bottle");
        assertThat(PackUnits.packUnitLabel("Tube", "GM")).isEqualTo("tube");
        assertThat(PackUnits.packUnitLabel("Vial", "EACH")).isEqualTo("vial");
        assertThat(PackUnits.packUnitLabel("Drops", "ML")).isEqualTo("bottle");

        // No / unknown packaging word — infer from the base unit.
        assertThat(PackUnits.packUnitLabel(null, "TABLET")).isEqualTo("strip");
        assertThat(PackUnits.packUnitLabel(null, "ML")).isEqualTo("bottle");
        assertThat(PackUnits.packUnitLabel(null, "GM")).isEqualTo("tube");
        assertThat(PackUnits.packUnitLabel(null, "EACH")).isEqualTo("unit");
        assertThat(PackUnits.packUnitLabel(null, null)).isEqualTo("unit");

        // A size string in the packaging field is ignored, not shown.
        assertThat(PackUnits.packUnitLabel("100ml", "ML")).isEqualTo("bottle");
    }

    @Test
    @DisplayName("isMeasured is true only for volume/weight base units")
    void isMeasured() {
        assertThat(PackUnits.isMeasured("ML")).isTrue();
        assertThat(PackUnits.isMeasured("GM")).isTrue();
        assertThat(PackUnits.isMeasured("TABLET")).isFalse();
        assertThat(PackUnits.isMeasured("CAPSULE")).isFalse();
        assertThat(PackUnits.isMeasured("EACH")).isFalse();
        assertThat(PackUnits.isMeasured(null)).isFalse();
    }

    @Test
    @DisplayName("plural leaves measured units alone")
    void plural() {
        assertThat(PackUnits.plural("bottle", 1)).isEqualTo("bottle");
        assertThat(PackUnits.plural("bottle", 2)).isEqualTo("bottles");
        assertThat(PackUnits.plural("ml", 5)).isEqualTo("ml");
        assertThat(PackUnits.plural("g", 5)).isEqualTo("g");
    }
}
