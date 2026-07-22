package com.checkup.pharmacy.modules.suppliercreditnote;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.suppliercreditnote.dto.CreateCreditNoteRequest;
import com.checkup.pharmacy.modules.suppliercreditnote.dto.CreditNotePageResponse;
import com.checkup.pharmacy.modules.suppliercreditnote.dto.CreditNoteResponse;
import com.checkup.pharmacy.modules.suppliercreditnote.dto.UpdateCreditNoteStatusRequest;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;

/**
 * Supplier credit notes under /api/v1/supplier-credit-notes — tenant-scoped.
 * Create and status changes are OWNER-only; reads are open to any authenticated
 * staff member.
 */
@RestController
@RequestMapping("/api/v1/supplier-credit-notes")
public class SupplierCreditNoteController {

    private final SupplierCreditNoteService supplierCreditNoteService;

    public SupplierCreditNoteController(SupplierCreditNoteService supplierCreditNoteService) {
        this.supplierCreditNoteService = supplierCreditNoteService;
    }

    @GetMapping
    public ApiResponse<CreditNotePageResponse> list(
            @RequestParam(required = false) String supplierId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.ok(supplierCreditNoteService.list(supplierId, status, from, to, page, limit));
    }

    @PostMapping
    @PreAuthorize("hasRole('OWNER')")
    public ResponseEntity<ApiResponse<CreditNoteResponse>> create(@Valid @RequestBody CreateCreditNoteRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(supplierCreditNoteService.create(req)));
    }

    @GetMapping("/{id}")
    public ApiResponse<CreditNoteResponse> getById(@PathVariable String id) {
        return ApiResponse.ok(supplierCreditNoteService.getById(id));
    }

    @PatchMapping("/{id}/status")
    @PreAuthorize("hasRole('OWNER')")
    public ApiResponse<CreditNoteResponse> updateStatus(@PathVariable String id, @Valid @RequestBody UpdateCreditNoteStatusRequest req) {
        return ApiResponse.ok(supplierCreditNoteService.updateStatus(id, req));
    }
}
