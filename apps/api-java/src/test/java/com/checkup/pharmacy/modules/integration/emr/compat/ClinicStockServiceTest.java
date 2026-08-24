package com.checkup.pharmacy.modules.integration.emr.compat;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.integration.emr.EmrIntegrationService;
import com.checkup.pharmacy.modules.integration.emr.compat.dto.ClinicStockResponse;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrMedicineMatchRequest;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrMedicineMatchResponse;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.security.UserPrincipal;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@DisplayName("Clinic stock adapter: 'unknown' and 'none' must stay distinguishable")
class ClinicStockServiceTest {

    private final EmrIntegrationService integrationService = mock(EmrIntegrationService.class);
    private final PharmacyRepository pharmacyRepository = mock(PharmacyRepository.class);
    private final MedicineRepository medicineRepository = mock(MedicineRepository.class);
    private final InventoryRepository inventoryRepository = mock(InventoryRepository.class);
    private final ClinicStockService service = new ClinicStockService(
            integrationService, pharmacyRepository, medicineRepository, inventoryRepository);

    @BeforeEach
    void tenant() {
        var principal = new UserPrincipal("user-1", "ph_1", Role.OWNER, "owner@pharmacy.test");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(principal, null, List.of()));
        Pharmacy pharmacy = Pharmacy.create("Rainbow Pharmacy", "rainbow");
        when(pharmacyRepository.findById("ph_1")).thenReturn(Optional.of(pharmacy));
        when(medicineRepository.findAllById(any())).thenReturn(List.of());
        when(medicineRepository.findAlternatives(any(), any(), any(), any())).thenReturn(List.of());
        when(inventoryRepository.findActiveNonExpiredByMedicineIdIn(anyString(), any(), any()))
                .thenReturn(List.of());
    }

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    @Test
    @DisplayName("a matched, in-stock medicine reports its quantity and price")
    void reportsAMatchedMedicine() {
        matcherReturns(match("Paracetamol 500mg", "med_1", "Paracetamol 500mg", "Paracetamol",
                "500mg", "Tablet", 40, new BigDecimal("22.50")));

        ClinicStockResponse response = service.lookup(List.of("Paracetamol 500mg"));

        assertThat(response.pharmacyName()).isEqualTo("Rainbow Pharmacy");
        ClinicStockResponse.Item item = response.items().get(0);
        assertThat(item.matched()).isTrue();
        assertThat(item.availableQuantity()).isEqualTo(40);
        assertThat(item.mrp()).isEqualByComparingTo("22.50");
        assertThat(item.stockStatus()).isEqualTo("in_stock");
    }

    @Test
    @DisplayName("an UNMATCHED medicine reports zero WITHOUT claiming to be out of stock")
    void distinguishesUnknownFromOutOfStock() {
        // This is the property the whole DTO exists to protect: a medicine the pharmacy has
        // never heard of and one it has run out of must not collapse into the same answer.
        matcherReturns(unmatched("Some Unlisted Brand"));

        ClinicStockResponse response = service.lookup(List.of("Some Unlisted Brand"));

        ClinicStockResponse.Item item = response.items().get(0);
        assertThat(item.matched()).isFalse();
        assertThat(item.medicineId()).isNull();
        assertThat(item.availableQuantity()).isZero();
        assertThat(item.stockStatus()).isEqualTo("unknown");
    }

    @Test
    @DisplayName("a matched medicine with nothing on the shelf is out_of_stock, never 'in stock, 0 left'")
    void aMatchedMedicineWithNoStockIsOutOfStock() {
        // The regression this field was added for. With no stockStatus on the wire the clinic's
        // badge fell through to its in-stock wording and displayed "In stock — 0 left" for a
        // medicine this pharmacy could not dispense at all.
        matcherReturns(match("Azithromycin 500mg", "med_2", "Azithromycin 500mg", "Azithromycin",
                "500mg", "Tablet", 0, null));

        ClinicStockResponse.Item item = service.lookup(List.of("Azithromycin 500mg")).items().get(0);

        assertThat(item.matched()).isTrue();
        assertThat(item.stockStatus()).isEqualTo("out_of_stock");
    }

    @Test
    @DisplayName("a nearly-exhausted medicine is low_stock, on the pharmacy's own threshold")
    void aNearlyExhaustedMedicineIsLowStock() {
        matcherReturns(match("Amoxicillin 250mg", "med_3", "Amoxicillin 250mg", "Amoxicillin",
                "250mg", "Capsule", 4, new BigDecimal("60.00")));

        ClinicStockResponse.Item item = service.lookup(List.of("Amoxicillin 250mg")).items().get(0);

        assertThat(item.stockStatus()).isEqualTo("low_stock");
    }

    @Test
    @DisplayName("schedule and manufacturer come off the catalogue row, which the match engine does not carry")
    void enrichesFromTheCatalogue() {
        Medicine medicine = Medicine.create("Alprazolam 0.5mg", new BigDecimal("12"));
        medicine.applyFields("Alprazolam", "Sun Pharma", null, null, "H1", null,
                new BigDecimal("12"), "Tablet", "0.5mg", "strip", "10s");
        when(medicineRepository.findAllById(any())).thenReturn(List.of(medicine));

        matcherReturns(match("Alprazolam 0.5mg", medicine.getId(), "Alprazolam 0.5mg", "Alprazolam",
                "0.5mg", "Tablet", 30, new BigDecimal("80.00")));

        ClinicStockResponse.Item item = service.lookup(List.of("Alprazolam 0.5mg")).items().get(0);

        assertThat(item.schedule()).isEqualTo("H1");
        assertThat(item.manufacturer()).isEqualTo("Sun Pharma");
    }

    @Test
    @DisplayName("earliest expiry counts only stock that can actually be sold")
    void earliestExpirySkipsFullyReservedBatches() {
        Instant soon = Instant.now().plus(20, ChronoUnit.DAYS);
        Instant later = Instant.now().plus(300, ChronoUnit.DAYS);

        // The nearest-dated batch is entirely spoken for by an in-progress bill. Warning the
        // prescriber off a course over stock they will never be handed is a false alarm.
        Inventory reserved = Inventory.create("ph_1", "med_1", "B1", soon, 10,
                new BigDecimal("5"), new BigDecimal("10"), 10, 5);
        reserved.reserve(10);
        Inventory sellable = Inventory.create("ph_1", "med_1", "B2", later, 50,
                new BigDecimal("5"), new BigDecimal("11"), 10, 5);
        when(inventoryRepository.findActiveNonExpiredByMedicineIdIn(anyString(), any(), any()))
                .thenReturn(List.of(reserved, sellable));

        matcherReturns(match("Paracetamol 500mg", "med_1", "Paracetamol 500mg", "Paracetamol",
                "500mg", "Tablet", 50, new BigDecimal("11")));

        ClinicStockResponse.Item item = service.lookup(List.of("Paracetamol 500mg")).items().get(0);

        assertThat(item.earliestExpiry()).isEqualTo(later);
    }

    @Test
    @DisplayName("a short medicine is offered same-generic substitutes the pharmacy actually holds")
    void offersSubstitutesForAShortMedicine() {
        Medicine stocked = Medicine.create("Calpol 500", new BigDecimal("12"));
        stocked.applyFields("Paracetamol", "GSK", null, null, null, null,
                new BigDecimal("12"), "Tablet", "500mg", "strip", "15s");
        Medicine alsoEmpty = Medicine.create("Dolo 500", new BigDecimal("12"));
        alsoEmpty.applyFields("Paracetamol", "Micro Labs", null, null, null, null,
                new BigDecimal("12"), "Tablet", "500mg", "strip", "15s");
        when(medicineRepository.findAlternatives(any(), any(), any(), any()))
                .thenReturn(List.of(stocked, alsoEmpty));
        when(inventoryRepository.findActiveNonExpiredByMedicineIdIn(anyString(), any(), any()))
                .thenAnswer(inv -> List.of(Inventory.create("ph_1", stocked.getId(), "B1",
                        Instant.now().plus(200, ChronoUnit.DAYS), 60,
                        new BigDecimal("4"), new BigDecimal("18.00"), 10, 5)));

        matcherReturns(match("Crocin 500", "med_1", "Paracetamol 500mg", "Paracetamol",
                "500mg", "Tablet", 0, null));

        ClinicStockResponse.Item item = service.lookup(List.of("Crocin 500")).items().get(0);

        // Only the one that can be dispensed today. An alternative the pharmacy is also out of
        // sends the prescriber round the same loop twice.
        assertThat(item.substitutes()).hasSize(1);
        assertThat(item.substitutes().get(0).medicineName()).isEqualTo("Calpol 500");
        assertThat(item.substitutes().get(0).availableQuantity()).isEqualTo(60);
        assertThat(item.substitutes().get(0).mrp()).isEqualByComparingTo("18.00");
    }

    @Test
    @DisplayName("a medicine that is in stock is not cluttered with substitutes")
    void doesNotOfferSubstitutesForAMedicineInStock() {
        matcherReturns(match("Paracetamol 500mg", "med_1", "Paracetamol 500mg", "Paracetamol",
                "500mg", "Tablet", 400, new BigDecimal("22.50")));

        ClinicStockResponse.Item item = service.lookup(List.of("Paracetamol 500mg")).items().get(0);

        assertThat(item.substitutes()).isEmpty();
        org.mockito.Mockito.verify(medicineRepository, org.mockito.Mockito.never())
                .findAlternatives(any(), any(), any(), any());
    }

    @Test
    @DisplayName("substitutes are never a guess: no generic name, no suggestions")
    void noGenericNameMeansNoSubstitutes() {
        matcherReturns(match("Some Ointment", "med_9", "Some Ointment", null,
                null, "Cream", 0, null));

        ClinicStockResponse.Item item = service.lookup(List.of("Some Ointment")).items().get(0);

        assertThat(item.substitutes()).isEmpty();
        org.mockito.Mockito.verify(medicineRepository, org.mockito.Mockito.never())
                .findAlternatives(any(), any(), any(), any());
    }

    @Test
    @DisplayName("each requested name is echoed back so answers can be lined up without relying on order")
    void echoesTheRequestedName() {
        matcherReturns(match("Crocin 500", "med_1", "Paracetamol 500mg", "Paracetamol",
                "500mg", "Tablet", 5, null));

        ClinicStockResponse response = service.lookup(List.of("Crocin 500"));

        assertThat(response.items().get(0).requestedName()).isEqualTo("Crocin 500");
    }

    @Test
    @DisplayName("a comma inside one medicine name stays one medicine")
    void aCombinationProductIsOneName() {
        // "Vitamin B1, B6, B12" is one product. It reaches this service as one string, and the
        // controller must not have split it on the way in — see ClinicIntegrationController#stock.
        matcherReturns(unmatched("Vitamin B1, B6, B12"));

        service.lookup(List.of("Vitamin B1, B6, B12"));

        var captor = org.mockito.ArgumentCaptor.forClass(EmrMedicineMatchRequest.class);
        org.mockito.Mockito.verify(integrationService).matchMedicines(captor.capture());
        assertThat(captor.getValue().items()).hasSize(1);
        assertThat(captor.getValue().items().get(0).name()).isEqualTo("Vitamin B1, B6, B12");
    }

    @Test
    @DisplayName("blank names are omitted and counted, not sent to the matcher")
    void omitsBlankNames() {
        matcherReturns(match("Paracetamol", "med_1", "Paracetamol", null,
                null, null, 5, null));

        ClinicStockResponse response = service.lookup(java.util.Arrays.asList("Paracetamol", "", "   ", null));

        assertThat(response.namesOmitted()).isEqualTo(3);
    }

    @Test
    @DisplayName("a request past the cap is truncated, and the caller is told how much was dropped")
    void capsTheNumberOfNames() {
        List<String> names = new ArrayList<>();
        for (int i = 0; i < ClinicStockService.MAX_NAMES + 5; i++) {
            names.add("Medicine " + i);
        }
        when(integrationService.matchMedicines(any())).thenAnswer(inv -> {
            EmrMedicineMatchRequest req = inv.getArgument(0);
            return new EmrMedicineMatchResponse(req.items().stream()
                    .map(i -> new EmrMedicineMatchResponse.Item(i.externalItemId(), "UNMATCHED",
                            null, null, null, null, null, null, 0, null, false))
                    .toList());
        });

        ClinicStockResponse response = service.lookup(names);

        assertThat(response.namesOmitted()).isEqualTo(5);
        assertThat(response.items()).hasSize(ClinicStockService.MAX_NAMES);
    }

    @Test
    @DisplayName("an empty request is answered without calling the matcher at all")
    void emptyRequestSkipsTheMatcher() {
        ClinicStockResponse response = service.lookup(List.of());

        assertThat(response.items()).isEmpty();
        org.mockito.Mockito.verifyNoInteractions(integrationService);
    }

    @Test
    @DisplayName("a null names list is treated the same as an empty one")
    void nullNamesListIsTreatedAsEmpty() {
        ClinicStockResponse response = service.lookup(null);

        assertThat(response.items()).isEmpty();
        assertThat(response.namesOmitted()).isZero();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private void matcherReturns(EmrMedicineMatchResponse.Item... items) {
        when(integrationService.matchMedicines(any()))
                .thenReturn(new EmrMedicineMatchResponse(List.of(items)));
    }

    private static EmrMedicineMatchResponse.Item match(String requestedName, String medicineId, String name,
                                                       String genericName, String strength, String form,
                                                       int available, BigDecimal price) {
        return new EmrMedicineMatchResponse.Item(requestedName, "EXACT_NAME", medicineId, name,
                genericName, strength, form, "strip", available, price, false);
    }

    private static EmrMedicineMatchResponse.Item unmatched(String requestedName) {
        return new EmrMedicineMatchResponse.Item(requestedName, "UNMATCHED", null, null,
                null, null, null, null, 0, null, false);
    }
}
