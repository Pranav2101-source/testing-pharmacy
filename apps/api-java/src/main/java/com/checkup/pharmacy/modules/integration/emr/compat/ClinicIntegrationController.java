package com.checkup.pharmacy.modules.integration.emr.compat;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.integration.emr.EmrIntegrationService;
import com.checkup.pharmacy.modules.integration.emr.compat.dto.ClinicIngestRequest;
import com.checkup.pharmacy.modules.integration.emr.compat.dto.ClinicIngestResponse;
import com.checkup.pharmacy.modules.integration.emr.compat.dto.ClinicPairRequest;
import com.checkup.pharmacy.modules.integration.emr.compat.dto.ClinicPairResponse;
import com.checkup.pharmacy.modules.integration.emr.compat.dto.ClinicStockResponse;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionSnapshot;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * The compatibility EMR surface: {@code /api/v1/integration} (singular).
 *
 * <h2>Why a second prefix exists</h2>
 * {@code /api/v1/integrations/emr} is this product's preferred contract and is unchanged.
 * This prefix is the one the clinic's existing client already calls. Serving both means the
 * integration can go live without the other team changing and redeploying code first —
 * which, given that half is on an unmerged branch, is the difference between shipping and
 * waiting on a deploy nobody here controls.
 *
 * <p><b>Every method below is translation and authentication only.</b> Business logic —
 * idempotency, medicine matching, numbering — lives in {@code EmrIntegrationService} and is
 * reached through it via the per-endpoint compat service. The moment logic forks between the
 * two surfaces they start disagreeing about what a prescription is, and every bug has to be
 * found twice by someone who does not know the second surface exists.
 *
 * <h2>The prefix trap</h2>
 * {@code /api/v1/integration} is a strict prefix of {@code /api/v1/integrations}. A matcher
 * written without the trailing slash — here, in the filter, or in SecurityConfig — silently
 * captures the HMAC routes too. Keep the slash everywhere this prefix is written.
 */
@RestController
@RequestMapping("/api/v1/integration")
public class ClinicIntegrationController {

    private final ClinicPairingService pairingService;
    private final ClinicIngestService ingestService;
    private final ClinicStockService stockService;
    private final EmrIntegrationService integrationService;

    public ClinicIntegrationController(ClinicPairingService pairingService,
                                       ClinicIngestService ingestService,
                                       ClinicStockService stockService,
                                       EmrIntegrationService integrationService) {
        this.pairingService = pairingService;
        this.ingestService = ingestService;
        this.stockService = stockService;
        this.integrationService = integrationService;
    }

    /**
     * Redeems a pairing code for a clinic-scoped credential.
     *
     * <p>Reached without an API credential by design — this is where credentials come from.
     * The pairing code is the proof; see {@link ClinicPairingService}.
     */
    @PostMapping("/pair")
    public ApiResponse<ClinicPairResponse> pair(@Valid @RequestBody ClinicPairRequest request) {
        return ApiResponse.ok(pairingService.pair(request));
    }

    /** Hands a prescription to the pharmacy. Authenticated by API key/secret. */
    @PostMapping("/prescriptions")
    public ApiResponse<ClinicIngestResponse> ingest(@Valid @RequestBody ClinicIngestRequest request) {
        return ApiResponse.ok(ingestService.ingest(request));
    }

    /**
     * Live stock for a set of medicine names, at the moment a doctor is prescribing.
     *
     * <p>{@code name} is bound as a repeated query parameter, not a single delimited one —
     * medicine names legitimately contain commas ("Vitamin B1, B6, B12"), and joining them
     * on a separator that appears in the data would split one medicine into several that do
     * not exist. Do not "simplify" this to a single {@code String} parameter split on commas.
     */
    @GetMapping("/stock")
    public ApiResponse<ClinicStockResponse> stock(
            @RequestParam(name = "name", required = false) List<String> names) {
        return ApiResponse.ok(stockService.lookup(names));
    }

    /**
     * Withdraws a prescription the clinic already pushed. Routed straight to
     * {@code EmrIntegrationService} with no compat DTO in between — there is nothing to
     * translate: both the path shape and the response are already identical to the native
     * surface's, so a separate wrapper here would exist only to exist.
     */
    @DeleteMapping("/prescriptions/{emrClinicId}/{emrPrescriptionId}")
    public ApiResponse<EmrPrescriptionSnapshot> cancel(@PathVariable String emrClinicId,
                                                       @PathVariable String emrPrescriptionId) {
        return ApiResponse.ok(integrationService.cancel(emrClinicId, emrPrescriptionId));
    }
}
