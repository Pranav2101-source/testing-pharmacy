package com.checkup.pharmacy.modules.integration.emr;

import com.checkup.pharmacy.common.enums.PrescriptionStatus;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.sequence.DocumentSequenceService;
import com.checkup.pharmacy.modules.billing.InvoiceRepository;
import com.checkup.pharmacy.modules.doctor.DoctorRepository;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrMedicineMatchRequest;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionIngestRequest;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionSnapshot;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverrideRepository;
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
        DoctorRepository doctorRepository = mock(DoctorRepository.class);
        EmrIntegrationService service = new EmrIntegrationService(prescriptionRepository, itemRepository,
                invoiceRepository, medicineRepository, mock(PharmacyMedicineOverrideRepository.class),
                inventoryRepository, sequenceService, doctorRepository);
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
            assertThat(match.ambiguous()).isFalse();
        });
    }

    @Test
    @DisplayName("two active medicines sharing an exact name is AMBIGUOUS_NAME, not the same UNMATCHED a genuinely unknown drug gets")
    void twoMedicinesSharingAnExactNameIsReportedAsAmbiguousNotUnmatched() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        InvoiceRepository invoiceRepository = mock(InvoiceRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        InventoryRepository inventoryRepository = mock(InventoryRepository.class);
        DocumentSequenceService sequenceService = mock(DocumentSequenceService.class);
        DoctorRepository doctorRepository = mock(DoctorRepository.class);
        EmrIntegrationService service = new EmrIntegrationService(prescriptionRepository, itemRepository,
                invoiceRepository, medicineRepository, mock(PharmacyMedicineOverrideRepository.class),
                inventoryRepository, sequenceService, doctorRepository);
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                new UserPrincipal("machine", "ph-1", Role.OWNER, "emr@machine.local"), null, List.of()));

        // Two distinct catalogue rows that happen to share a display name — a real data-quality
        // case (two suppliers, same brand), not an unknown medicine.
        Medicine first = Medicine.create("Paracetamol 500", new BigDecimal("5"));
        Medicine second = Medicine.create("Paracetamol 500", new BigDecimal("6"));
        when(medicineRepository.findActiveForEmrMatch(any(), any())).thenReturn(List.of(first, second));

        var response = service.matchMedicines(new EmrMedicineMatchRequest(List.of(
                new EmrMedicineMatchRequest.Item("line-1", null, "Paracetamol 500", null, null, null))));

        assertThat(response.items()).singleElement().satisfies(match -> {
            assertThat(match.matchStrategy()).isEqualTo("AMBIGUOUS_NAME");
            assertThat(match.medicineId()).isNull();
            assertThat(match.ambiguous())
                    .as("a caller that only checks matchStrategy == UNMATCHED must be able to tell this apart")
                    .isTrue();
        });
    }

    @Test
    @DisplayName("a genuinely unknown medicine is still plain UNMATCHED, not ambiguous")
    void aGenuinelyUnknownMedicineIsNotAmbiguous() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        InvoiceRepository invoiceRepository = mock(InvoiceRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        InventoryRepository inventoryRepository = mock(InventoryRepository.class);
        DocumentSequenceService sequenceService = mock(DocumentSequenceService.class);
        DoctorRepository doctorRepository = mock(DoctorRepository.class);
        EmrIntegrationService service = new EmrIntegrationService(prescriptionRepository, itemRepository,
                invoiceRepository, medicineRepository, mock(PharmacyMedicineOverrideRepository.class),
                inventoryRepository, sequenceService, doctorRepository);
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                new UserPrincipal("machine", "ph-1", Role.OWNER, "emr@machine.local"), null, List.of()));
        when(medicineRepository.findActiveForEmrMatch(any(), any())).thenReturn(List.of());

        var response = service.matchMedicines(new EmrMedicineMatchRequest(List.of(
                new EmrMedicineMatchRequest.Item("line-1", null, "Totally Unknown Brand", null, null, null))));

        assertThat(response.items()).singleElement().satisfies(match -> {
            assertThat(match.matchStrategy()).isEqualTo("UNMATCHED");
            assertThat(match.ambiguous()).isFalse();
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
        DoctorRepository doctorRepository = mock(DoctorRepository.class);
        EmrIntegrationService service = new EmrIntegrationService(prescriptionRepository, itemRepository,
                invoiceRepository, medicineRepository, mock(PharmacyMedicineOverrideRepository.class),
                inventoryRepository, sequenceService, doctorRepository);
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
    @DisplayName("re-pushing with the SAME doctor regNo costs no DoctorRepository lookup — a retry storm shouldn't hammer it")
    void amendmentWithUnchangedDoctorRegNoSkipsTheLookup() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        DoctorRepository doctorRepository = mock(DoctorRepository.class);
        EmrIntegrationService service = new EmrIntegrationService(prescriptionRepository, itemRepository,
                mock(InvoiceRepository.class), mock(MedicineRepository.class),
                mock(PharmacyMedicineOverrideRepository.class), mock(InventoryRepository.class),
                mock(DocumentSequenceService.class), doctorRepository);
        authenticateAsMachine();

        // Already resolved once before — doctorId and doctorRegNo both already set, exactly
        // what a second push of the same prescription (a retry, or a genuinely unrelated
        // field edit) would look like.
        Prescription rx = Prescription.createFromEmr("ph-1", "RX-000001", "tenant-1", "rx-1", null,
                "doc-1", "Dr. Rao", "MCI-123", null, "Asha Verma", null, null, null, null, null, null);
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of());

        // Built directly, not via the ingestRequest() helper — that helper always sends a
        // null regNo, which would take the SAME "nothing to resolve" fast path for a
        // different reason (blank regNo) and not actually exercise the unchanged-regNo
        // short-circuit this test is for.
        var request = new EmrPrescriptionIngestRequest("tenant-1", "rx-1", null, "Dr. Rao", "MCI-123", null,
                "Asha Verma", null, null, null, null, null, null, List.of());
        service.applyAmendment(rx, request);

        assertThat(rx.getDoctorId()).isEqualTo("doc-1");
        verify(doctorRepository, never()).findByPharmacyIdAndRegistrationNo(any(), any());
        verify(doctorRepository, never()).save(any());
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

    // ─────────────────────────────────────────────────────────────────────────
    // Quantity calculation on ingest — see PrescriptionQuantityCalculator.
    // Wired into ingest()/applyAmendment() as a fallback for a line the clinic
    // sent with no usable quantity, using whatever medicine the matcher (or,
    // for an unchanged-name amendment line, the existing link) resolved.
    // ─────────────────────────────────────────────────────────────────────────

    /** Builds a service with its own sequence-service mock, stubbed to hand out sequence 1. */
    private static EmrIntegrationService serviceForIngest(PrescriptionRepository prescriptionRepository,
                                                          PrescriptionItemRepository itemRepository,
                                                          MedicineRepository medicineRepository) {
        return serviceForIngest(prescriptionRepository, itemRepository, medicineRepository,
                mock(PharmacyMedicineOverrideRepository.class));
    }

    private static EmrIntegrationService serviceForIngest(PrescriptionRepository prescriptionRepository,
                                                          PrescriptionItemRepository itemRepository,
                                                          MedicineRepository medicineRepository,
                                                          PharmacyMedicineOverrideRepository overrideRepository) {
        DocumentSequenceService sequenceService = mock(DocumentSequenceService.class);
        when(sequenceService.next(any(), any(), any())).thenReturn(1);
        return new EmrIntegrationService(prescriptionRepository, itemRepository, mock(InvoiceRepository.class),
                medicineRepository, overrideRepository, mock(InventoryRepository.class),
                sequenceService, mock(DoctorRepository.class));
    }

    private static List<PrescriptionItem> savedItems(PrescriptionItemRepository itemRepository) {
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<PrescriptionItem>> captor = ArgumentCaptor.forClass(List.class);
        verify(itemRepository).saveAll(captor.capture());
        return captor.getValue();
    }

    @Test
    @DisplayName("ingest computes the quantity from dosage x duration when the clinic sent none")
    void ingestComputesQuantityWhenMissing() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        EmrIntegrationService service = serviceForIngest(prescriptionRepository, itemRepository, medicineRepository);
        authenticateAsMachine();

        Medicine medicine = Medicine.create("Paracetamol 500", new BigDecimal("5"));
        medicine.setPackaging(10, "TABLET");
        when(medicineRepository.findActiveForEmrMatch(any(), any())).thenReturn(List.of(medicine));
        when(prescriptionRepository.findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                eq("ph-1"), eq("tenant-1"), eq("rx-1"))).thenReturn(Optional.empty());

        var item = new EmrPrescriptionIngestRequest.Item("item-1", "Paracetamol 500", null, null, null,
                0, "1-0-1", "6 days", null);
        service.ingest(ingestRequest("Dr. Ann Smith", "John Doe", List.of(item)));

        assertThat(savedItems(itemRepository)).singleElement().satisfies(saved -> {
            assertThat(saved.getQuantity()).isEqualTo(12);
            assertThat(saved.isQuantityAutoCalculated()).isTrue();
        });
    }

    @Test
    @DisplayName("an explicit EMR quantity is preserved and never recalculated over")
    void ingestPreservesAnExplicitQuantity() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        EmrIntegrationService service = serviceForIngest(prescriptionRepository, itemRepository, medicineRepository);
        authenticateAsMachine();

        Medicine medicine = Medicine.create("Paracetamol 500", new BigDecimal("5"));
        medicine.setPackaging(10, "TABLET");
        when(medicineRepository.findActiveForEmrMatch(any(), any())).thenReturn(List.of(medicine));
        when(prescriptionRepository.findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                eq("ph-1"), eq("tenant-1"), eq("rx-1"))).thenReturn(Optional.empty());

        // Dosage x duration would compute 12, but the clinic already stated 7 — its word wins.
        var item = new EmrPrescriptionIngestRequest.Item("item-1", "Paracetamol 500", null, null, null,
                7, "1-0-1", "6 days", null);
        service.ingest(ingestRequest("Dr. Ann Smith", "John Doe", List.of(item)));

        assertThat(savedItems(itemRepository)).singleElement().satisfies(saved -> {
            assertThat(saved.getQuantity()).isEqualTo(7);
            assertThat(saved.isQuantityAutoCalculated()).isFalse();
        });
    }

    @Test
    @DisplayName("a liquid medicine (ML base unit) is left for a pharmacist even with a clean-looking pattern")
    void ingestDoesNotCalculateForLiquids() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        EmrIntegrationService service = serviceForIngest(prescriptionRepository, itemRepository, medicineRepository);
        authenticateAsMachine();

        Medicine syrup = Medicine.create("Cough Syrup", new BigDecimal("5"));
        syrup.setPackaging(null, "ML");
        when(medicineRepository.findActiveForEmrMatch(any(), any())).thenReturn(List.of(syrup));
        when(prescriptionRepository.findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                eq("ph-1"), eq("tenant-1"), eq("rx-1"))).thenReturn(Optional.empty());

        var item = new EmrPrescriptionIngestRequest.Item("item-1", "Cough Syrup", null, null, null,
                0, "10ml-0-10ml", "6 days", null);
        service.ingest(ingestRequest("Dr. Ann Smith", "John Doe", List.of(item)));

        assertThat(savedItems(itemRepository)).singleElement().satisfies(saved -> {
            assertThat(saved.needsQuantityConfirmation()).isTrue();
            assertThat(saved.isQuantityAutoCalculated()).isFalse();
        });
    }

    @Test
    @DisplayName("a clinic quantity for a measured medicine with no pack size is set aside for confirmation, "
            + "not billed as N bottles")
    void ingestDefersAmbiguousMeasuredQuantity() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        EmrIntegrationService service = serviceForIngest(prescriptionRepository, itemRepository, medicineRepository);
        authenticateAsMachine();

        Medicine syrup = Medicine.create("Melgain", new BigDecimal("12"));
        syrup.setPackaging(null, "ML");
        when(medicineRepository.findActiveForEmrMatch(any(), any())).thenReturn(List.of(syrup));
        when(prescriptionRepository.findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                eq("ph-1"), eq("tenant-1"), eq("rx-1"))).thenReturn(Optional.empty());

        // The clinic computed 30 (ml). With no mL-per-bottle on record the dispensing engine
        // would read that as 30 whole bottles — so it must not flow straight through.
        var item = new EmrPrescriptionIngestRequest.Item("item-1", "Melgain", null, null, null,
                30, "3ml-0-3ml", "5 days", null);
        service.ingest(ingestRequest("Dr. Ann Smith", "John Doe", List.of(item)));

        assertThat(savedItems(itemRepository)).singleElement().satisfies(saved -> {
            assertThat(saved.getQuantity()).isZero();
            assertThat(saved.needsQuantityConfirmation()).isTrue();
            assertThat(saved.getQuantityCalculationNote()).contains("30 ml");
        });
    }

    @Test
    @DisplayName("a clinic quantity for a CLASSIFIED measured medicine flows through unchanged — 30 ml is unambiguous")
    void ingestKeepsAMeasuredQuantityWhenThePackSizeIsKnown() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        EmrIntegrationService service = serviceForIngest(prescriptionRepository, itemRepository, medicineRepository);
        authenticateAsMachine();

        Medicine syrup = Medicine.create("Melgain 60ml", new BigDecimal("12"));
        syrup.setPackaging(60, "ML");
        when(medicineRepository.findActiveForEmrMatch(any(), any())).thenReturn(List.of(syrup));
        when(prescriptionRepository.findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                eq("ph-1"), eq("tenant-1"), eq("rx-1"))).thenReturn(Optional.empty());

        var item = new EmrPrescriptionIngestRequest.Item("item-1", "Melgain 60ml", null, null, null,
                30, "3ml-0-3ml", "5 days", null);
        service.ingest(ingestRequest("Dr. Ann Smith", "John Doe", List.of(item)));

        assertThat(savedItems(itemRepository)).singleElement().satisfies(saved -> {
            assertThat(saved.getQuantity()).isEqualTo(30);
            assertThat(saved.needsQuantityConfirmation()).isFalse();
        });
    }

    @Test
    @DisplayName("a pharmacy pack-size override (catalogue still unclassified) is enough to let the quantity through")
    void ingestRespectsAnOverridePackSizeForMeasuredLines() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        PharmacyMedicineOverrideRepository overrideRepository = mock(PharmacyMedicineOverrideRepository.class);
        EmrIntegrationService service = serviceForIngest(prescriptionRepository, itemRepository, medicineRepository,
                overrideRepository);
        authenticateAsMachine();

        Medicine syrup = Medicine.create("Melgain", new BigDecimal("12"));
        syrup.setPackaging(null, "ML");
        when(medicineRepository.findActiveForEmrMatch(any(), any())).thenReturn(List.of(syrup));
        when(prescriptionRepository.findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                eq("ph-1"), eq("tenant-1"), eq("rx-1"))).thenReturn(Optional.empty());
        var override = com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverride.create("ph-1", syrup.getId());
        override.applyLoosePos(false, 100);
        when(overrideRepository.findByIdPharmacyIdAndIdMedicineIdIn(eq("ph-1"), any())).thenReturn(List.of(override));

        var item = new EmrPrescriptionIngestRequest.Item("item-1", "Melgain", null, null, null,
                30, "3ml-0-3ml", "5 days", null);
        service.ingest(ingestRequest("Dr. Ann Smith", "John Doe", List.of(item)));

        assertThat(savedItems(itemRepository)).singleElement().satisfies(saved -> {
            assertThat(saved.getQuantity()).isEqualTo(30);
            assertThat(saved.needsQuantityConfirmation()).isFalse();
        });
    }

    @Test
    @DisplayName("an unparseable dosage leaves the line for manual confirmation without failing ingest")
    void ingestLeavesAmbiguousLinesForManualConfirmation() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        EmrIntegrationService service = serviceForIngest(prescriptionRepository, itemRepository, medicineRepository);
        authenticateAsMachine();

        Medicine medicine = Medicine.create("Paracetamol 500", new BigDecimal("5"));
        medicine.setPackaging(10, "TABLET");
        when(medicineRepository.findActiveForEmrMatch(any(), any())).thenReturn(List.of(medicine));
        when(prescriptionRepository.findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                eq("ph-1"), eq("tenant-1"), eq("rx-1"))).thenReturn(Optional.empty());

        var item = new EmrPrescriptionIngestRequest.Item("item-1", "Paracetamol 500", null, null, null,
                0, "As directed", null, null);
        service.ingest(ingestRequest("Dr. Ann Smith", "John Doe", List.of(item)));

        assertThat(savedItems(itemRepository)).singleElement().satisfies(saved -> {
            assertThat(saved.needsQuantityConfirmation()).isTrue();
            assertThat(saved.isQuantityAutoCalculated()).isFalse();
        });
    }

    @Test
    @DisplayName("an unmatched line (no catalogue medicine) is left alone — there is no base unit to calculate against")
    void ingestDoesNotCalculateForAnUnmatchedLine() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        EmrIntegrationService service = serviceForIngest(prescriptionRepository, itemRepository, medicineRepository);
        authenticateAsMachine();

        when(medicineRepository.findActiveForEmrMatch(any(), any())).thenReturn(List.of());
        when(prescriptionRepository.findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                eq("ph-1"), eq("tenant-1"), eq("rx-1"))).thenReturn(Optional.empty());

        var item = new EmrPrescriptionIngestRequest.Item("item-1", "Totally Unknown Brand", null, null, null,
                0, "1-0-1", "6 days", null);
        service.ingest(ingestRequest("Dr. Ann Smith", "John Doe", List.of(item)));

        assertThat(savedItems(itemRepository)).singleElement().satisfies(saved -> {
            assertThat(saved.getMedicineId()).isNull();
            assertThat(saved.needsQuantityConfirmation()).isTrue();
        });
    }

    @Test
    @DisplayName("amendment computes the quantity for a newly-added line the same way ingest does")
    void amendmentComputesQuantityForANewLine() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        EmrIntegrationService service = serviceWith(prescriptionRepository, itemRepository, medicineRepository);
        authenticateAsMachine();

        Prescription rx = emrPrescription();
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of());
        Medicine medicine = Medicine.create("Azithromycin 500", new BigDecimal("5"));
        medicine.setPackaging(6, "TABLET");
        when(medicineRepository.findActiveForEmrMatch(any(), any())).thenReturn(List.of(medicine));

        var newItem = new EmrPrescriptionIngestRequest.Item("item-new", "Azithromycin 500", null, null, null,
                0, "1-0-0", "3 days", null);
        service.applyAmendment(rx, ingestRequest("Dr. Rao", "Asha Verma", List.of(newItem)));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<PrescriptionItem>> captor = ArgumentCaptor.forClass(List.class);
        verify(itemRepository).saveAll(captor.capture());
        assertThat(captor.getValue()).singleElement().satisfies(saved -> {
            assertThat(saved.getQuantity()).isEqualTo(3);
            assertThat(saved.isQuantityAutoCalculated()).isTrue();
        });
    }

    @Test
    @DisplayName("amendment does not recompute over a quantity a pharmacist already confirmed")
    void amendmentDoesNotRecalculateAnAlreadyConfirmedLine() {
        PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
        PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
        MedicineRepository medicineRepository = mock(MedicineRepository.class);
        EmrIntegrationService service = serviceWith(prescriptionRepository, itemRepository, medicineRepository);
        authenticateAsMachine();

        Prescription rx = emrPrescription();
        // A pharmacist already confirmed 6 units by hand for this line, at the counter.
        PrescriptionItem existingItem = PrescriptionItem.createFromEmr("ph-1", rx.getId(), "item-1", "Dolo 650",
                "med-1", null, 6, "1-0-1", "6 days", null);
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of(existingItem));

        // Same name, quantity re-sent as 6 (unchanged) — an ordinary retry/edit, not a
        // clinic clearing the field back to "no quantity".
        var item = new EmrPrescriptionIngestRequest.Item("item-1", "Dolo 650", null, null, null,
                6, "1-0-1", "6 days", null);
        service.applyAmendment(rx, ingestRequest("Dr. Rao", "Asha Verma", List.of(item)));

        assertThat(existingItem.getQuantity()).isEqualTo(6);
        assertThat(existingItem.isQuantityAutoCalculated()).isFalse();
        verify(medicineRepository, never()).findAllById(any());
    }

    private static EmrPrescriptionIngestRequest ingestRequest(String doctorName, String patientName,
                                                               List<EmrPrescriptionIngestRequest.Item> items) {
        return new EmrPrescriptionIngestRequest("tenant-1", "rx-1", null, doctorName, null, null,
                patientName, null, null, null, null, null, null, items);
    }

    private static EmrIntegrationService serviceWith(PrescriptionRepository prescriptionRepository) {
        return new EmrIntegrationService(prescriptionRepository, mock(PrescriptionItemRepository.class),
                mock(InvoiceRepository.class), mock(MedicineRepository.class),
                mock(PharmacyMedicineOverrideRepository.class), mock(InventoryRepository.class),
                mock(DocumentSequenceService.class), mock(DoctorRepository.class));
    }

    private static EmrIntegrationService serviceWith(PrescriptionRepository prescriptionRepository,
                                                      PrescriptionItemRepository itemRepository,
                                                      MedicineRepository medicineRepository) {
        return serviceWith(prescriptionRepository, itemRepository, medicineRepository,
                mock(PharmacyMedicineOverrideRepository.class));
    }

    private static EmrIntegrationService serviceWith(PrescriptionRepository prescriptionRepository,
                                                      PrescriptionItemRepository itemRepository,
                                                      MedicineRepository medicineRepository,
                                                      PharmacyMedicineOverrideRepository overrideRepository) {
        return new EmrIntegrationService(prescriptionRepository, itemRepository,
                mock(InvoiceRepository.class), medicineRepository, overrideRepository,
                mock(InventoryRepository.class), mock(DocumentSequenceService.class), mock(DoctorRepository.class));
    }

    private static void authenticateAsMachine() {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                new UserPrincipal("machine", "ph-1", Role.OWNER, "emr@machine.local"), null, List.of()));
    }

    private static Prescription emrPrescription() {
        return Prescription.createFromEmr("ph-1", "RX-000001", "tenant-1", "rx-1", null, null,
                "Dr. Rao", null, null, "Asha Verma", null, null, null, null, null, null);
    }
}
