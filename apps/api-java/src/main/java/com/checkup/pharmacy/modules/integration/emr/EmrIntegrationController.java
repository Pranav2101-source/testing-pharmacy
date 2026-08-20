package com.checkup.pharmacy.modules.integration.emr;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrMedicineMatchRequest;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrMedicineMatchResponse;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionIngestRequest;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionSnapshot;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/integrations/emr")
public class EmrIntegrationController {

    private final EmrIntegrationService service;
    private final EmrPrescriptionIntake intake;

    public EmrIntegrationController(EmrIntegrationService service, EmrPrescriptionIntake intake) {
        this.service = service;
        this.intake = intake;
    }

    @PostMapping("/prescriptions")
    public ApiResponse<EmrPrescriptionSnapshot> ingest(@Valid @RequestBody EmrPrescriptionIngestRequest request) {
        // Through the intake rather than the service directly: a clinic retrying a push
        // that is already in flight must get the stored prescription, not a 500.
        return ApiResponse.ok(intake.ingest(request));
    }

    @GetMapping("/prescriptions/{externalTenantId}/{externalPrescriptionId}")
    public ApiResponse<EmrPrescriptionSnapshot> get(@PathVariable String externalTenantId,
                                                    @PathVariable String externalPrescriptionId) {
        return ApiResponse.ok(service.get(externalTenantId, externalPrescriptionId));
    }

    @PostMapping("/medicines/match")
    public ApiResponse<EmrMedicineMatchResponse> match(@Valid @RequestBody EmrMedicineMatchRequest request) {
        return ApiResponse.ok(service.matchMedicines(request));
    }

    /**
     * Withdraws a prescription the clinic already pushed. See
     * {@link EmrIntegrationService#cancel} for what this does and does not allow.
     */
    @DeleteMapping("/prescriptions/{externalTenantId}/{externalPrescriptionId}")
    public ApiResponse<EmrPrescriptionSnapshot> cancel(@PathVariable String externalTenantId,
                                                       @PathVariable String externalPrescriptionId) {
        return ApiResponse.ok(service.cancel(externalTenantId, externalPrescriptionId));
    }
}
