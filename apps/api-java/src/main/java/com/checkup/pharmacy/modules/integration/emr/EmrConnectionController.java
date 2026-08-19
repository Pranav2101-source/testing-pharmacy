package com.checkup.pharmacy.modules.integration.emr;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrConnectionKeyResponse;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrConnectionStatus;
import com.checkup.pharmacy.modules.integration.emr.dto.SaveEmrClinicRequest;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The pharmacy's clinic-connection screen.
 *
 * <p>Under /api/v1/pharmacy deliberately, NOT under /api/v1/integrations/emr — that
 * prefix is the machine surface, which SecurityConfig leaves open to the HMAC filter
 * rather than to staff JWTs. A staff screen hanging off it would be unauthenticated.
 *
 * <p>Reads are open to any signed-in staff member so a pharmacist can see whether the
 * clinic link is healthy; the writes issue or revoke a credential, so they stay with
 * OWNER/MANAGER — the same split PharmacyController already uses for the tenant profile.
 */
@RestController
@RequestMapping("/api/v1/pharmacy/emr-connection")
public class EmrConnectionController {

    private final EmrConnectionService service;

    public EmrConnectionController(EmrConnectionService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<EmrConnectionStatus> status() {
        return ApiResponse.ok(service.status());
    }

    @PutMapping
    @PreAuthorize("hasAnyRole('OWNER','MANAGER')")
    public ApiResponse<EmrConnectionStatus> save(@Valid @RequestBody SaveEmrClinicRequest req) {
        return ApiResponse.ok(service.saveClinic(req));
    }

    @PostMapping("/key")
    @PreAuthorize("hasAnyRole('OWNER','MANAGER')")
    public ApiResponse<EmrConnectionKeyResponse> generateKey() {
        return ApiResponse.ok(service.generateKey());
    }

    @DeleteMapping
    @PreAuthorize("hasAnyRole('OWNER','MANAGER')")
    public ApiResponse<EmrConnectionStatus> disconnect() {
        return ApiResponse.ok(service.disconnect());
    }
}
