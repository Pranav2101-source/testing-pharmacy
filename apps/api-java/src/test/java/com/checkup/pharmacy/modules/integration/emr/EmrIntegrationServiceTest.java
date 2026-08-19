package com.checkup.pharmacy.modules.integration.emr;

import com.checkup.pharmacy.common.enums.PrescriptionStatus;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.sequence.DocumentSequenceService;
import com.checkup.pharmacy.modules.billing.InvoiceRepository;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrMedicineMatchRequest;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionIngestRequest;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.prescription.PrescriptionItem;
import com.checkup.pharmacy.modules.prescription.PrescriptionItemRepository;
import com.checkup.pharmacy.modules.prescription.PrescriptionRepository;
import com.checkup.pharmacy.security.UserPrincipal;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.slf4j.MDC;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
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
}
