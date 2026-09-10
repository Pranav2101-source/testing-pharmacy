package com.checkup.pharmacy.modules.medicine;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

class PackSizeSignalTest {

    private static PackSignalBuilder signal() {
        return new PackSignalBuilder();
    }

    /** Melgain as it actually happened: 40 ml, a bogus 5 ml pack size, engine says 8 bottles. */
    private static final class PackSignalBuilder {
        String pharmacyId = "ph_1";
        String medicineId = "med_1";
        int enginePackCount = 8;
        int actualPackCount = 1;
        BigDecimal clinicalVolume = new BigDecimal("40");
        int declaredPackSize = 5;

        PackSignalBuilder engine(int v) { this.enginePackCount = v; return this; }
        PackSignalBuilder actual(int v) { this.actualPackCount = v; return this; }
        PackSignalBuilder volume(String v) { this.clinicalVolume = v == null ? null : new BigDecimal(v); return this; }
        PackSignalBuilder declared(int v) { this.declaredPackSize = v; return this; }
        PackSignalBuilder pharmacy(String v) { this.pharmacyId = v; return this; }
        PackSignalBuilder medicine(String v) { this.medicineId = v; return this; }

        PackSizeSignal capture() {
            return PackSizeSignal.capture(pharmacyId, medicineId, "inv_1", "item_1",
                    enginePackCount, actualPackCount, clinicalVolume, declaredPackSize);
        }
    }

    @Test
    @DisplayName("the incident: 40 ml billed as one bottle against a 5 ml pack size implies at least 40")
    void capturesTheMelgainCorrection() {
        PackSizeSignal s = signal().capture();

        assertThat(s).isNotNull();
        assertThat(s.getEnginePackCount()).isEqualTo(8);
        assertThat(s.getActualPackCount()).isEqualTo(1);
        assertThat(s.getDeclaredPackSize()).isEqualTo(5);
        assertThat(s.getImpliedPackSize()).isEqualTo(40);
        assertThat(s.getResolvedAt()).isNull();
    }

    @Test
    @DisplayName("no signal when the pharmacist accepted the engine's count — agreement carries no information")
    void noSignalWhenNothingWasOverridden() {
        assertThat(signal().engine(2).actual(2).capture()).isNull();
    }

    @Test
    @DisplayName("no signal when nothing was handed over — that is a fact about the shelf, not the pack")
    void noSignalWhenNothingDispensed() {
        assertThat(signal().actual(0).capture()).isNull();
        assertThat(signal().engine(0).capture()).isNull();
    }

    @Test
    @DisplayName("no signal without a clinical volume or a declared pack size — the arithmetic would be meaningless")
    void noSignalWithoutTheInputs() {
        assertThat(signal().volume(null).capture()).isNull();
        assertThat(signal().volume("0").capture()).isNull();
        assertThat(signal().declared(0).capture()).isNull();
        assertThat(signal().pharmacy(null).capture()).isNull();
        assertThat(signal().medicine(null).capture()).isNull();
    }

    @Test
    @DisplayName("the implied size rounds UP — the packs handed over had to COVER the prescribed volume")
    void impliedSizeIsACeiling() {
        // 100 ml across 3 bottles: each must hold at least 34, never 33.
        PackSizeSignal s = signal().volume("100").actual(3).engine(20).capture();
        assertThat(s.getImpliedPackSize()).isEqualTo(34);
    }

    @Test
    @DisplayName("a pharmacist handing over MORE than the engine asked for is a signal too")
    void overrideUpwardIsAlsoASignal() {
        // Engine said 1 bottle for 200 ml against a declared 200; pharmacist used 4. That
        // implies a 50 ml bottle — the catalogue is too LARGE, which matters just as much.
        PackSizeSignal s = signal().volume("200").declared(200).engine(1).actual(4).capture();
        assertThat(s).isNotNull();
        assertThat(s.getImpliedPackSize()).isEqualTo(50);
    }

    @Test
    @DisplayName("resolving a signal records why it was counted, so the evidence outlives the sweep")
    void resolveStampsTheReason() {
        PackSizeSignal s = signal().capture();
        java.time.Instant when = java.time.Instant.parse("2026-09-11T03:20:00Z");

        s.resolve("Counted toward quarantine", when);

        assertThat(s.getResolvedAt()).isEqualTo(when);
        assertThat(s.getResolutionNote()).isEqualTo("Counted toward quarantine");
    }
}
