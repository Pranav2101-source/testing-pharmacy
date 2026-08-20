package com.checkup.pharmacy.modules.integration.emr;

import com.checkup.pharmacy.common.enums.PrescriptionStatus;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.sequence.DocumentSequenceService;
import com.checkup.pharmacy.modules.billing.InvoiceRepository;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrMedicineMatchRequest;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionIngestRequest;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionSnapshot;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.prescription.Prescription;
import com.checkup.pharmacy.modules.prescription.PrescriptionItem;
import com.checkup.pharmacy.modules.prescription.PrescriptionItemRepository;
import com.checkup.pharmacy.modules.prescription.PrescriptionRepository;
import com.checkup.pharmacy.security.UserPrincipal;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.slf4j.MDC;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EmrIntegrationServiceTest {

    private static final Instant RECEIVED_AT = Instant.parse("2026-08-19T10:00:00Z");

    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
        MDC.clear();
    }

    @Test
    void activePrescriptionBecomesNotPurchasedOnlyAfterTwoHoursWithNothingDispensed() {
        assertThat(EmrIntegrationService.deriveStatus(PrescriptionStatus.ACTIVE, RECEIVED_AT,
                List.of(0, 0), RECEIVED_AT.plusSeconds(7199))).isEqualTo("RECEIVED");
        assertThat(EmrIntegrationService.deriveStatus(PrescriptionStatus.ACTIVE, RECEIVED_AT,
                List.of(0, 0), RECEIVED_AT.plusSeconds(7200))).isEqualTo("NOT_PURCHASED");
    }

    @Test
    void aLaterDispenseAlwaysSupersedesTheDerivedNotPurchasedState() {
        Instant later = RECEIVED_AT.plusSeconds(10_000);
        assertThat(EmrIntegrationService.deriveStatus(PrescriptionStatus.PARTIAL, RECEIVED_AT,
                List.of(2, 0), later)).isEqualTo("PARTIALLY_PURCHASED");
        assertThat(EmrIntegrationService.deriveStatus(PrescriptionStatus.DISPENSED, RECEIVED_AT,
                List.of(2, 5), later)).isEqualTo("DISPENSED");
    }

    @Test
    void anActivePrescriptionWithAnyDispenseIsNotMisreportedAsNotPurchased() {
        assertThat(EmrIntegrationService.deriveStatus(PrescriptionStatus.ACTIVE, RECEIVED_AT,
                List.of(1, 0), RECEIVED_AT.plusSeconds(10_000))).isEqualTo("RECEIVED");
    }

    @Test
    void exactCatalogueMatchIncludesLiveAvailableQuantityAndApproximatePrice() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        InvoiceRepository invoiceRepository = mock(InvoiceRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        InventoryRepository inventoryRepository = mock(InventoryRepository.class);
        DocumentSequenceService sequenceService = mock(DocumentSequenceService.class);
        EmrIntegrationService service = new EmrIntegrationService(prescriptionRepository, itemRepository,
                invoiceRepository, medicineRepository, inventoryRepository, sequenceService);
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                new UserPrincipal("machine", "ph-1", Role.OWNER, "emr@machine.local"), null, List.of()));

        Medicine medicine = Medicine.create("Paracetamol 500", new BigDecimal("5"));
        Inventory batch = Inventory.create("ph-1", medicine.getId(), "B-1", Instant.now().plusSeconds(86_400),
                12, new BigDecimal("10"), new BigDecimal("18.50"), 2, 1);
        when(medicineRepository.findActiveForEmrMatch(any(), any())).thenReturn(List.of(medicine));
        when(inventoryRepository.findActiveNonExpiredByMedicineIdIn(eq("ph-1"), any(), any()))
                .thenReturn(List.of(batch));

        var response = service.matchMedicines(new EmrMedicineMatchRequest(List.of(
                new EmrMedicineMatchRequest.Item("line-1", null, "  PARACETAMOL   500 ", null, null, null))));

        assertThat(response.items()).singleElement().satisfies(match -> {
            assertThat(match.matchStrategy()).isEqualTo("EXACT_NAME");
            assertThat(match.medicineId()).isEqualTo(medicine.getId());
            assertThat(match.availableQuantity()).isEqualTo(12);
            assertThat(match.approximatePrice()).isEqualByComparingTo("18.50");
        });
    }

    @Test
    void ingestResolvesItemsByNameInsteadOfTheEmrInternalMedicineIdAndNeverRejectsAnUnmatchedOne() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        InvoiceRepository invoiceRepository = mock(InvoiceRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        InventoryRepository inventoryRepository = mock(InventoryRepository.class);
        DocumentSequenceService sequenceService = mock(DocumentSequenceService.class);
        EmrIntegrationService service = new EmrIntegrationService(prescriptionRepository, itemRepository,
                invoiceRepository, medicineRepository, inventoryRepository, sequenceService);
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                new UserPrincipal("machine", "ph-1", Role.OWNER, "emr@machine.local"), null, List.of()));

        Medicine medicine = Medicine.create("Paracetamol 500", new BigDecimal("5"));
        when(medicineRepository.findActiveForEmrMatch(any(), any())).thenReturn(List.of(medicine));
        when(prescriptionRepository.findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                eq("ph-1"), eq("tenant-1"), eq("rx-1"))).thenReturn(Optional.empty());
        when(sequenceService.next(eq("ph-1"), eq(DocumentSequenceService.PRESCRIPTION),
                eq(DocumentSequenceService.PERIOD_ALL))).thenReturn(1);

        // The EMR-internal id ("emr:line-1") is never a real pharmacy Medicine.id — it must
        // not be used for lookup, and it must not cause a reject. An item whose name has no
        // catalogue match must resolve to a null medicineId rather than failing the whole request.
        var matchedItem = new EmrPrescriptionIngestRequest.Item("line-1", "  PARACETAMOL   500 ", "emr:line-1",
                null, null, 2, "1-0-1", "5 days", null);
        var unmatchedItem = new EmrPrescriptionIngestRequest.Item("line-2", "Some Unknown Drug", "emr:line-2",
                null, null, 1, null, null, null);
        var request = new EmrPrescriptionIngestRequest("tenant-1", "rx-1", null, "Dr. Ann Smith", null, null,
                "John Doe", 30, null, null, null, null, null, List.of(matchedItem, unmatchedItem));

        service.ingest(request);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<PrescriptionItem>> captor = ArgumentCaptor.forClass(List.class);
        org.mockito.Mockito.verify(itemRepository).saveAll(captor.capture());
        List<PrescriptionItem> saved = captor.getValue();
        assertThat(saved).hasSize(2);
        assertThat(saved.get(0).getMedicineId()).isEqualTo(medicine.getId());
        assertThat(saved.get(1).getMedicineId()).isNull();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // cancel() — a clinic withdrawing a prescription it already pushed.
    // Same two rules as PrescriptionService.cancel(), deliberately not relaxed or
    // tightened for the machine caller — see the javadoc on the method itself.
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("cancelling an ACTIVE prescription marks it CANCELLED and persists it")
    void cancelMarksAnActivePrescriptionCancelled() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        EmrIntegrationService service = serviceWith(prescriptionRepository);
        authenticateAsMachine();

        Prescription rx = emrPrescription();
        when(prescriptionRepository.findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                eq("ph-1"), eq("tenant-1"), eq("rx-1"))).thenReturn(Optional.of(rx));

        var snapshot = service.cancel("tenant-1", "rx-1");

        assertThat(rx.getStatus()).isEqualTo(PrescriptionStatus.CANCELLED);
        assertThat(snapshot.status()).isEqualTo("CANCELLED");
        verify(prescriptionRepository).save(rx);
    }

    @Test
    @DisplayName("a PARTIALLY dispensed prescription can still be cancelled — what was sold stays sold")
    void cancelAllowsAPartiallyDispensedPrescription() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        EmrIntegrationService service = serviceWith(prescriptionRepository);
        authenticateAsMachine();

        Prescription rx = emrPrescription();
        rx.markPartiallyDispensed();
        when(prescriptionRepository.findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                eq("ph-1"), eq("tenant-1"), eq("rx-1"))).thenReturn(Optional.of(rx));

        service.cancel("tenant-1", "rx-1");

        assertThat(rx.getStatus()).isEqualTo(PrescriptionStatus.CANCELLED);
    }

    @Test
    @DisplayName("a fully DISPENSED prescription cannot be cancelled — the medicine already left the pharmacy")
    void cancelRejectsAFullyDispensedPrescription() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        EmrIntegrationService service = serviceWith(prescriptionRepository);
        authenticateAsMachine();

        Prescription rx = emrPrescription();
        rx.markDispensed();
        when(prescriptionRepository.findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                eq("ph-1"), eq("tenant-1"), eq("rx-1"))).thenReturn(Optional.of(rx));

        assertThatThrownBy(() -> service.cancel("tenant-1", "rx-1"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("dispensed");
        assertThat(rx.getStatus()).isEqualTo(PrescriptionStatus.DISPENSED);
        verify(prescriptionRepository, never()).save(any());
    }

    @Test
    @DisplayName("cancelling an already-cancelled prescription is an error, not a silent no-op")
    void cancelRejectsAnAlreadyCancelledPrescription() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        EmrIntegrationService service = serviceWith(prescriptionRepository);
        authenticateAsMachine();

        Prescription rx = emrPrescription();
        rx.cancel();
        when(prescriptionRepository.findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                eq("ph-1"), eq("tenant-1"), eq("rx-1"))).thenReturn(Optional.of(rx));

        assertThatThrownBy(() -> service.cancel("tenant-1", "rx-1"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("already cancelled");
    }

    @Test
    @DisplayName("cancelling a prescription this clinic never pushed is a plain not-found, not a leak")
    void cancelRejectsAnUnknownExternalId() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        EmrIntegrationService service = serviceWith(prescriptionRepository);
        authenticateAsMachine();

        when(prescriptionRepository.findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                eq("ph-1"), eq("tenant-1"), eq("rx-missing"))).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.cancel("tenant-1", "rx-missing"))
                .isInstanceOf(NotFoundException.class);
    }

    @Test
    @DisplayName("leading/trailing whitespace on the external ids does not change which prescription is found")
    void cancelTrimsExternalIds() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        EmrIntegrationService service = serviceWith(prescriptionRepository);
        authenticateAsMachine();

        Prescription rx = emrPrescription();
        when(prescriptionRepository.findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                eq("ph-1"), eq("tenant-1"), eq("rx-1"))).thenReturn(Optional.of(rx));

        service.cancel("  tenant-1  ", "  rx-1  ");

        assertThat(rx.getStatus()).isEqualTo(PrescriptionStatus.CANCELLED);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // applyAmendment() — a doctor's edit, re-pushed under the same
    // externalEmrPrescriptionId. See the method's own javadoc for why ACTIVE-only
    // is stricter than cancel()'s guard, and why items are merged rather than
    // replaced wholesale.
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("amending updates the prescription's own fields")
    void amendmentUpdatesPrescriptionFields() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        EmrIntegrationService service = serviceWith(prescriptionRepository, itemRepository, medicineRepository);
        authenticateAsMachine();

        Prescription rx = emrPrescription();
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of());

        var request = ingestRequest("Dr. New Name", "New Patient Name", List.of());
        service.applyAmendment(rx, request);

        assertThat(rx.getDoctorName()).isEqualTo("Dr. New Name");
        assertThat(rx.getPatientName()).isEqualTo("New Patient Name");
        verify(prescriptionRepository).save(rx);
    }

    @Test
    @DisplayName("an item whose name is UNCHANGED keeps its existing medicineId — a pharmacist's manual link survives")
    void amendmentPreservesAnUnchangedLinesManualLink() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        EmrIntegrationService service = serviceWith(prescriptionRepository, itemRepository, medicineRepository);
        authenticateAsMachine();

        Prescription rx = emrPrescription();
        // Pharmacist manually linked this earlier — the matcher never found "Dolo 650" on
        // the first ingest, and they picked a catalogue row by hand via the review panel.
        PrescriptionItem existingItem = PrescriptionItem.createFromEmr("ph-1", rx.getId(), "item-1", "Dolo 650",
                "manually-linked-medicine-id", null, 10, null, null, null);
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of(existingItem));

        // Same name, but the quantity changed — a real edit, just not to the medicine itself.
        var item = new EmrPrescriptionIngestRequest.Item("item-1", "Dolo 650", null, null, null, 20, null, null, null);
        service.applyAmendment(rx, ingestRequest("Dr. Rao", "Asha Verma", List.of(item)));

        assertThat(existingItem.getMedicineId()).isEqualTo("manually-linked-medicine-id");
        assertThat(existingItem.getQuantity()).isEqualTo(20);
        verify(medicineRepository, never()).findActiveForEmrMatch(any(), any());
    }

    @Test
    @DisplayName("an item whose name CHANGED is re-matched, dropping the old link")
    void amendmentRematchesALineWhoseNameChanged() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        EmrIntegrationService service = serviceWith(prescriptionRepository, itemRepository, medicineRepository);
        authenticateAsMachine();

        Prescription rx = emrPrescription();
        PrescriptionItem existingItem = PrescriptionItem.createFromEmr("ph-1", rx.getId(), "item-1", "Dolo 650",
                "old-medicine-id-for-dolo", null, 10, null, null, null);
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of(existingItem));

        Medicine newMedicine = Medicine.create("Azithromycin 500", new BigDecimal("5"));
        when(medicineRepository.findActiveForEmrMatch(any(), any())).thenReturn(List.of(newMedicine));

        // The doctor changed their mind about the drug entirely, same line id.
        var item = new EmrPrescriptionIngestRequest.Item("item-1", "Azithromycin 500", null, null, null, 6,
                null, null, null);
        service.applyAmendment(rx, ingestRequest("Dr. Rao", "Asha Verma", List.of(item)));

        assertThat(existingItem.getMedicineId()).isEqualTo(newMedicine.getId());
        assertThat(existingItem.getMedicineName()).isEqualTo("Azithromycin 500");
    }

    @Test
    @DisplayName("a new externalItemId not seen before is added as a new line")
    void amendmentAddsANewLine() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        EmrIntegrationService service = serviceWith(prescriptionRepository, itemRepository, medicineRepository);
        authenticateAsMachine();

        Prescription rx = emrPrescription();
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of());
        when(medicineRepository.findActiveForEmrMatch(any(), any())).thenReturn(List.of());

        var newItem = new EmrPrescriptionIngestRequest.Item("item-new", "Vitamin D3", null, null, null, 30,
                null, null, null);
        var snapshot = service.applyAmendment(rx, ingestRequest("Dr. Rao", "Asha Verma", List.of(newItem)));

        assertThat(snapshot.items()).extracting(EmrPrescriptionSnapshot.Item::externalItemId)
                .containsExactly("item-new");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<PrescriptionItem>> captor = ArgumentCaptor.forClass(List.class);
        verify(itemRepository).saveAll(captor.capture());
        assertThat(captor.getValue()).hasSize(1);
    }

    @Test
    @DisplayName("a line dropped from the payload is deleted — the doctor removed it")
    void amendmentDeletesARemovedLine() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        EmrIntegrationService service = serviceWith(prescriptionRepository, itemRepository, medicineRepository);
        authenticateAsMachine();

        Prescription rx = emrPrescription();
        PrescriptionItem keep = PrescriptionItem.createFromEmr("ph-1", rx.getId(), "item-keep", "Dolo 650",
                "med-1", null, 10, null, null, null);
        PrescriptionItem drop = PrescriptionItem.createFromEmr("ph-1", rx.getId(), "item-drop", "Vitamin C",
                "med-2", null, 5, null, null, null);
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of(keep, drop));

        // Only "item-keep" is in the amended payload — "item-drop" was removed by the doctor.
        var keptItem = new EmrPrescriptionIngestRequest.Item("item-keep", "Dolo 650", null, null, null, 10,
                null, null, null);
        service.applyAmendment(rx, ingestRequest("Dr. Rao", "Asha Verma", List.of(keptItem)));

        // deleteAll receives remainingByExternalItemId.values() — a Map's Collection view,
        // never a List — so the captor has to be typed for that, not List.
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<PrescriptionItem>> captor = ArgumentCaptor.forClass(Collection.class);
        verify(itemRepository).deleteAll(captor.capture());
        assertThat(captor.getValue()).extracting(PrescriptionItem::getExternalEmrItemId).containsExactly("item-drop");
    }

    @Test
    @DisplayName("re-pushing identical data is a no-op amendment — safe, not a special case")
    void amendmentWithIdenticalDataChangesNothingMeaningful() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        EmrIntegrationService service = serviceWith(prescriptionRepository, itemRepository, medicineRepository);
        authenticateAsMachine();

        Prescription rx = emrPrescription();
        PrescriptionItem existingItem = PrescriptionItem.createFromEmr("ph-1", rx.getId(), "item-1", "Dolo 650",
                "med-1", null, 10, null, null, null);
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of(existingItem));

        var sameItem = new EmrPrescriptionIngestRequest.Item("item-1", "Dolo 650", null, null, null, 10,
                null, null, null);
        service.applyAmendment(rx, ingestRequest("Dr. Rao", "Asha Verma", List.of(sameItem)));

        assertThat(existingItem.getMedicineId()).isEqualTo("med-1");
        assertThat(existingItem.getQuantity()).isEqualTo(10);
        verify(itemRepository, never()).deleteAll(any());
    }

    @Test
    @DisplayName("amending a PARTIALLY dispensed prescription is rejected — stricter than cancel, which allows PARTIAL")
    void amendmentRejectsAPartiallyDispensedPrescription() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        EmrIntegrationService service = serviceWith(prescriptionRepository, mock(PrescriptionItemRepository.class),
                mock(MedicineRepository.class));
        authenticateAsMachine();

        Prescription rx = emrPrescription();
        rx.markPartiallyDispensed();

        assertThatThrownBy(() -> service.applyAmendment(rx, ingestRequest("Dr. Rao", "Asha Verma", List.of())))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("Cancel it and send a new one");
    }

    @Test
    @DisplayName("amending a fully dispensed prescription is rejected")
    void amendmentRejectsADispensedPrescription() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        EmrIntegrationService service = serviceWith(prescriptionRepository, mock(PrescriptionItemRepository.class),
                mock(MedicineRepository.class));
        authenticateAsMachine();

        Prescription rx = emrPrescription();
        rx.markDispensed();

        assertThatThrownBy(() -> service.applyAmendment(rx, ingestRequest("Dr. Rao", "Asha Verma", List.of())))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    @DisplayName("amending a cancelled prescription is rejected")
    void amendmentRejectsACancelledPrescription() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        EmrIntegrationService service = serviceWith(prescriptionRepository, mock(PrescriptionItemRepository.class),
                mock(MedicineRepository.class));
        authenticateAsMachine();

        Prescription rx = emrPrescription();
        rx.cancel();

        assertThatThrownBy(() -> service.applyAmendment(rx, ingestRequest("Dr. Rao", "Asha Verma", List.of())))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    @DisplayName("a duplicate externalItemId in an amendment is rejected, same as on first ingest")
    void amendmentRejectsDuplicateExternalItemIds() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        EmrIntegrationService service = serviceWith(prescriptionRepository, itemRepository,
                mock(MedicineRepository.class));
        authenticateAsMachine();

        Prescription rx = emrPrescription();
        when(prescriptionRepository.findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                eq("ph-1"), eq("tenant-1"), eq("rx-1"))).thenReturn(Optional.of(rx));

        var dup1 = new EmrPrescriptionIngestRequest.Item("item-1", "Dolo 650", null, null, null, 10, null, null, null);
        var dup2 = new EmrPrescriptionIngestRequest.Item("item-1", "Crocin", null, null, null, 5, null, null, null);

        assertThatThrownBy(() -> service.ingest(ingestRequest("Dr. Rao", "Asha Verma", List.of(dup1, dup2))))
                .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class)
                .hasMessageContaining("Duplicate externalItemId");
    }

    private static EmrPrescriptionIngestRequest ingestRequest(String doctorName, String patientName,
                                                               List<EmrPrescriptionIngestRequest.Item> items) {
        return new EmrPrescriptionIngestRequest("tenant-1", "rx-1", null, doctorName, null, null,
                patientName, null, null, null, null, null, null, items);
    }

    private static EmrIntegrationService serviceWith(PrescriptionRepository prescriptionRepository) {
        return new EmrIntegrationService(prescriptionRepository, mock(PrescriptionItemRepository.class),
                mock(InvoiceRepository.class), mock(MedicineRepository.class), mock(InventoryRepository.class),
                mock(DocumentSequenceService.class));
    }

    private static EmrIntegrationService serviceWith(PrescriptionRepository prescriptionRepository,
                                                      PrescriptionItemRepository itemRepository,
                                                      MedicineRepository medicineRepository) {
        return new EmrIntegrationService(prescriptionRepository, itemRepository,
                mock(InvoiceRepository.class), medicineRepository, mock(InventoryRepository.class),
                mock(DocumentSequenceService.class));
    }

    private static void authenticateAsMachine() {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                new UserPrincipal("machine", "ph-1", Role.OWNER, "emr@machine.local"), null, List.of()));
    }

    private static Prescription emrPrescription() {
        return Prescription.createFromEmr("ph-1", "RX-000001", "tenant-1", "rx-1", null,
                "Dr. Rao", null, null, "Asha Verma", null, null, null, null, null, null);
    }
}
