package com.checkup.pharmacy.modules.supplierreturn;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.supplierreturn.dto.CreateSupplierReturnRequest;
import com.checkup.pharmacy.modules.supplierreturn.dto.SupplierReturnPageResponse;
import com.checkup.pharmacy.modules.supplierreturn.dto.SupplierReturnResponse;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
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
 * Supplier returns (debit notes) under /api/v1/supplier-returns — tenant-scoped.
 * Every write (create, confirm, cancel) is OWNER-only since confirming moves
 * physical stock and the supplier ledger balance; reads are open to any
 * authenticated staff member.
 */
@RestController
@RequestMapping("/api/v1/supplier-returns")
public class SupplierReturnsController {

    private final SupplierReturnsService supplierReturnsService;

    public SupplierReturnsController(SupplierReturnsService supplierReturnsService) {
        this.supplierReturnsService = supplierReturnsService;
    }

    @GetMapping
    public ApiResponse<SupplierReturnPageResponse> list(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String supplierId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.ok(supplierReturnsService.list(status, supplierId, from, to, page, limit));
    }

    @PostMapping
    @PreAuthorize("hasRole('OWNER')")
    public ResponseEntity<ApiResponse<SupplierReturnResponse>> create(@Valid @RequestBody CreateSupplierReturnRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(supplierReturnsService.create(req)));
    }

    @GetMapping("/{id}")
    public ApiResponse<SupplierReturnResponse> getById(@PathVariable String id) {
        return ApiResponse.ok(supplierReturnsService.getById(id));
    }

    @PatchMapping("/{id}/confirm")
    @PreAuthorize("hasRole('OWNER')")
    public ApiResponse<SupplierReturnResponse> confirm(@PathVariable String id) {
        return ApiResponse.ok(supplierReturnsService.confirm(id));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('OWNER')")
    public ApiResponse<SupplierReturnResponse> cancel(@PathVariable String id) {
        return ApiResponse.ok(supplierReturnsService.cancel(id));
    }
}
