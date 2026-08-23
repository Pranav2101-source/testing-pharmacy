package com.checkup.pharmacy.modules.integration.emr.compat;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.integration.emr.EmrIntegrationService;
import com.checkup.pharmacy.modules.integration.emr.compat.dto.ClinicStockResponse;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrMedicineMatchRequest;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrMedicineMatchResponse;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.security.UserPrincipal;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@DisplayName("Clinic stock adapter: 'unknown' and 'none' must stay distinguishable")
class ClinicStockServiceTest {

    private final EmrIntegrationService integrationService = mock(EmrIntegrationService.class);
    private final PharmacyRepository pharmacyRepository = mock(PharmacyRepository.class);
    private final ClinicStockService service = new ClinicStockService(integrationService, pharmacyRepository);

    @BeforeEach
    void tenant() {
        var principal = new UserPrincipal("user-1", "ph_1", Role.OWNER, "owner@pharmacy.test");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(principal, null, List.of()));
        Pharmacy pharmacy = Pharmacy.create("Rainbow Pharmacy", "rainbow");
        when(pharmacyRepository.findById("ph_1")).thenReturn(Optional.of(pharmacy));
    }

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    @Test
    @DisplayName("a matched, in-stock medicine reports its quantity and price")
    void reportsAMatchedMedicine() {
        when(integrationService.matchMedicines(any())).thenReturn(new EmrMedicineMatchResponse(List.of(
                new EmrMedicineMatchResponse.Item("Paracetamol 500mg", "EXACT_NAME", "med_1",
                        "Paracetamol 500mg", "Paracetamol", "500mg", "Tablet", "strip",
                        40, new BigDecimal("22.50"), false))));

        ClinicStockResponse response = service.lookup(List.of("Paracetamol 500mg"));

        assertThat(response.pharmacyName()).isEqualTo("Rainbow Pharmacy");
        ClinicStockResponse.Item item = response.items().get(0);
        assertThat(item.matched()).isTrue();
        assertThat(item.availableQuantity()).isEqualTo(40);
        assertThat(item.mrp()).isEqualByComparingTo("22.50");
    }

    @Test
    @DisplayName("an UNMATCHED medicine reports zero WITHOUT claiming to be out of stock")
    void distinguishesUnknownFromOutOfStock() {
        // This is the property the whole DTO exists to protect: a medicine the pharmacy has
        // never heard of and one it has run out of must not collapse into the same answer.
        when(integrationService.matchMedicines(any())).thenReturn(new EmrMedicineMatchResponse(List.of(
                new EmrMedicineMatchResponse.Item("Some Unlisted Brand", "UNMATCHED", null,
                        null, null, null, null, null, 0, null, false))));

        ClinicStockResponse response = service.lookup(List.of("Some Unlisted Brand"));

        ClinicStockResponse.Item item = response.items().get(0);
        assertThat(item.matched()).isFalse();
        assertThat(item.medicineId()).isNull();
        assertThat(item.availableQuantity()).isZero();
    }

    @Test
    @DisplayName("each requested name is echoed back so answers can be lined up without relying on order")
    void echoesTheRequestedName() {
        when(integrationService.matchMedicines(any())).thenReturn(new EmrMedicineMatchResponse(List.of(
                new EmrMedicineMatchResponse.Item("Crocin 500", "EXACT_NAME", "med_1",
                        "Paracetamol 500mg", "Paracetamol", "500mg", "Tablet", "strip", 5, null, false))));

        ClinicStockResponse response = service.lookup(List.of("Crocin 500"));

        assertThat(response.items().get(0).requestedName()).isEqualTo("Crocin 500");
    }

    @Test
    @DisplayName("blank names are omitted and counted, not sent to the matcher")
    void omitsBlankNames() {
        when(integrationService.matchMedicines(any())).thenReturn(new EmrMedicineMatchResponse(List.of(
                new EmrMedicineMatchResponse.Item("Paracetamol", "EXACT_NAME", "med_1",
                        "Paracetamol", null, null, null, null, 5, null, false))));

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
}
