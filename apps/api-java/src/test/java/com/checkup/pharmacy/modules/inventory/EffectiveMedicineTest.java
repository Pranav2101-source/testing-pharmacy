package com.checkup.pharmacy.modules.inventory;

import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicine;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Pure resolution logic — no Spring context, no database. {@code InventoryServiceIT}/
 * {@code BillingService} integration tests cover this wired into the real enrichment and
 * billing paths; this covers every branch of the decision itself in isolation.
 */
class EffectiveMedicineTest {

    /** {@code Medicine.create} assigns its own id (Cuid) — callers read it back via {@code getId()}. */
    private static Medicine catalogueMedicine(String name) {
        return Medicine.create(name, new BigDecimal("12"));
    }

    @Test
    @DisplayName("a direct catalogue link is returned unchanged — no local medicine involved")
    void directLinkReturnsItself() {
        Medicine direct = catalogueMedicine("Paracetamol");

        Medicine resolved = EffectiveMedicine.resolve(direct, null, Map.of(), Map.of());

        assertThat(resolved).isSameAs(direct);
    }

    @Test
    @DisplayName("no direct link and no local medicine id resolves to null")
    void noLinkNoLocalIdResolvesToNull() {
        Medicine resolved = EffectiveMedicine.resolve(null, null, Map.of(), Map.of());

        assertThat(resolved).isNull();
    }

    @Test
    @DisplayName("a local medicine id that is not in the fetched map resolves to null, not a throw")
    void unknownLocalMedicineResolvesToNull() {
        Medicine resolved = EffectiveMedicine.resolve(null, "local-missing", Map.of(), Map.of());

        assertThat(resolved).isNull();
    }

    @Test
    @DisplayName("PENDING local medicine — no catalogue behaviour borrowed")
    void pendingLocalMedicineResolvesToNull() {
        PharmacyMedicine local = PharmacyMedicine.create("ph-1", "PCM Local", null, null,
                null, null, null, null, new BigDecimal("12"), null);
        Medicine catalogue = catalogueMedicine("Paracetamol");

        Medicine resolved = EffectiveMedicine.resolve(null, local.getId(),
                Map.of(local.getId(), local), Map.of(catalogue.getId(), catalogue));

        assertThat(resolved).as("PENDING never borrows catalogue behaviour, even if a linkedMedicineId map is provided").isNull();
    }

    @Test
    @DisplayName("SUGGESTED local medicine — a fuzzy candidate not yet confirmed borrows nothing")
    void suggestedLocalMedicineResolvesToNull() {
        PharmacyMedicine local = PharmacyMedicine.create("ph-1", "PCM Local", null, null,
                null, null, null, null, new BigDecimal("12"), null);
        local.markSuggested();

        Medicine resolved = EffectiveMedicine.resolve(null, local.getId(), Map.of(local.getId(), local), Map.of());

        assertThat(resolved).isNull();
    }

    @Test
    @DisplayName("KEPT_LOCAL — a pharmacist confirmed this is its own product, not a catalogue one")
    void keptLocalResolvesToNull() {
        PharmacyMedicine local = PharmacyMedicine.create("ph-1", "PCM Local", null, null,
                null, null, null, null, new BigDecimal("12"), null);
        local.keepLocal();

        Medicine resolved = EffectiveMedicine.resolve(null, local.getId(), Map.of(local.getId(), local), Map.of());

        assertThat(resolved).isNull();
    }

    @Test
    @DisplayName("LINKED local medicine resolves to its linked catalogue medicine")
    void linkedLocalMedicineResolvesToLinkedCatalogueMedicine() {
        Medicine catalogue = catalogueMedicine("Cetirizine 10mg Tablet");
        PharmacyMedicine local = PharmacyMedicine.create("ph-1", "Cetirizine", null, null,
                null, null, null, null, new BigDecimal("12"), null);
        local.confirmLink(catalogue.getId());

        Medicine resolved = EffectiveMedicine.resolve(null, local.getId(),
                Map.of(local.getId(), local), Map.of(catalogue.getId(), catalogue));

        assertThat(resolved).isSameAs(catalogue);
    }

    @Test
    @DisplayName("LINKED local medicine whose target is missing from the fetched map falls back to null")
    void linkedLocalMedicineWithMissingTargetResolvesToNull() {
        PharmacyMedicine local = PharmacyMedicine.create("ph-1", "Cetirizine", null, null,
                null, null, null, null, new BigDecimal("12"), null);
        local.confirmLink("med-deleted");

        // linkedMedicinesById does NOT contain "med-deleted" — e.g. the catalogue row was
        // since deleted, or a caller forgot to fold linked ids into its fetch.
        Medicine resolved = EffectiveMedicine.resolve(null, local.getId(),
                Map.of(local.getId(), local), Map.of());

        assertThat(resolved).as("a dangling link must degrade to local-only behaviour, never NPE").isNull();
    }

    @Test
    @DisplayName("unlinked (KEPT_LOCAL after a reversed link) does not resurrect the old link")
    void unlinkedAfterReversalResolvesToNull() {
        Medicine catalogue = catalogueMedicine("Cetirizine 10mg Tablet");
        PharmacyMedicine local = PharmacyMedicine.create("ph-1", "Cetirizine", null, null,
                null, null, null, null, new BigDecimal("12"), null);
        local.confirmLink(catalogue.getId());
        local.unlink();

        Medicine resolved = EffectiveMedicine.resolve(null, local.getId(),
                Map.of(local.getId(), local), Map.of(catalogue.getId(), catalogue));

        assertThat(resolved).isNull();
    }
}
