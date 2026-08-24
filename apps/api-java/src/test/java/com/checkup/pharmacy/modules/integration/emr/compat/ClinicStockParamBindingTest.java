package com.checkup.pharmacy.modules.integration.emr.compat;

import com.checkup.pharmacy.common.ratelimit.RateLimitService;
import com.checkup.pharmacy.modules.integration.emr.EmrIntegrationService;
import com.checkup.pharmacy.modules.integration.emr.compat.dto.ClinicStockResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/**
 * How drug names arrive at the compat stock endpoint.
 *
 * <p>Exists for one defect, which was live and silent. Binding the parameter as
 * {@code @RequestParam List<String>} makes Spring convert a single value to a collection by
 * <b>splitting it on commas</b> — so {@code name=Vitamin B1, B6, B12} reached
 * {@link ClinicStockService} as three drugs that do not exist. All three came back unmatched,
 * and because the clinic lines answers up by the name it sent, the real combination product
 * matched nothing at all and the prescriber saw no availability for it. Combination products
 * with commas in their names are ordinary in Indian prescribing, and the clinic sends exactly
 * one name per request — which is precisely the case that triggers the split.
 *
 * <p>The signature is the fix, so the signature is what this pins. A future tidy-up that
 * "simplifies" {@code HttpServletRequest} back to a bound list reintroduces the bug, and
 * nothing else on either side of this integration would notice.
 */
@DisplayName("Compat stock endpoint: a comma inside a drug name is not a separator")
class ClinicStockParamBindingTest {

    private final ClinicPairingService pairingService = mock(ClinicPairingService.class);
    private final ClinicIngestService ingestService = mock(ClinicIngestService.class);
    private final ClinicStockService stockService = mock(ClinicStockService.class);
    private final EmrIntegrationService integrationService = mock(EmrIntegrationService.class);
    private final RateLimitService rateLimitService = mock(RateLimitService.class);

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        when(stockService.lookup(any())).thenReturn(new ClinicStockResponse(null, List.of(), 0));
        mockMvc = MockMvcBuilders.standaloneSetup(new ClinicIntegrationController(
                pairingService, ingestService, stockService, integrationService, rateLimitService)).build();
    }

    @Test
    @DisplayName("one combination product stays one medicine, not three")
    void keepsACommaInsideADrugNameIntact() throws Exception {
        mockMvc.perform(get("/api/v1/integration/stock").param("name", "Vitamin B1, B6, B12"));

        assertThat(captureNames()).containsExactly("Vitamin B1, B6, B12");
    }

    @Test
    @DisplayName("repeated parameters remain the way to ask about several drugs")
    void stillAcceptsSeveralNamesAsRepeatedParameters() throws Exception {
        mockMvc.perform(get("/api/v1/integration/stock")
                .param("name", "Amoxicillin 500")
                .param("name", "Paracetamol 650"));

        // The fix must not have traded one binding bug for another.
        assertThat(captureNames()).containsExactly("Amoxicillin 500", "Paracetamol 650");
    }

    @Test
    @DisplayName("no names at all is an empty list, not a null the service has to guess at")
    void noNamesIsAnEmptyList() throws Exception {
        mockMvc.perform(get("/api/v1/integration/stock"));

        assertThat(captureNames()).isEmpty();
    }

    @Test
    @DisplayName("medicine search forwards its query and result limit")
    void bindsMedicineSearchParameters() throws Exception {
        mockMvc.perform(get("/api/v1/integration/medicines")
                .param("q", "para 500")
                .param("limit", "12"));

        verify(stockService).search("para 500", 12);
    }

    private List<String> captureNames() {
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<String>> captor = ArgumentCaptor.forClass(List.class);
        verify(stockService).lookup(captor.capture());
        return captor.getValue();
    }
}
