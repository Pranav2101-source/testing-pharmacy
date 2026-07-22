package com.checkup.pharmacy.modules.pharmacy;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.pharmacy.dto.PharmacyResponse;
import com.checkup.pharmacy.modules.pharmacy.dto.UpdateDocumentsRequest;
import com.checkup.pharmacy.modules.pharmacy.dto.UpdatePharmacyRequest;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Tenant profile endpoints under /api/v1/pharmacy. Reads are open to any
 * authenticated user (billing/PO views need them); writes are restricted to
 * OWNER/MANAGER.
 */
@RestController
@RequestMapping("/api/v1/pharmacy")
public class PharmacyController {

    private final PharmacyService pharmacyService;

    public PharmacyController(PharmacyService pharmacyService) {
        this.pharmacyService = pharmacyService;
    }

    @GetMapping
    public ApiResponse<PharmacyResponse> get() {
        return ApiResponse.ok(pharmacyService.getCurrent());
    }

    @PutMapping
    @PreAuthorize("hasAnyRole('OWNER','MANAGER')")
    public ApiResponse<PharmacyResponse> update(@Valid @RequestBody UpdatePharmacyRequest req) {
        return ApiResponse.ok(pharmacyService.update(req));
    }

    @PatchMapping("/documents")
    @PreAuthorize("hasAnyRole('OWNER','MANAGER')")
    public ApiResponse<PharmacyResponse> updateDocuments(@Valid @RequestBody UpdateDocumentsRequest req) {
        return ApiResponse.ok(pharmacyService.updateDocuments(req.documents()));
    }
}
