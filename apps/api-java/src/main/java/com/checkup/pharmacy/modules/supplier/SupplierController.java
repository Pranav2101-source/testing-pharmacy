package com.checkup.pharmacy.modules.supplier;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.supplier.dto.SupplierHistoryResponse;
import com.checkup.pharmacy.modules.supplier.dto.SupplierListResponse;
import com.checkup.pharmacy.modules.supplier.dto.SupplierRequest;
import com.checkup.pharmacy.modules.supplier.dto.SupplierResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Supplier master under /api/v1/suppliers — tenant-scoped, open to any authenticated staff member. */
@RestController
@RequestMapping("/api/v1/suppliers")
public class SupplierController {

    private final SupplierService supplierService;

    public SupplierController(SupplierService supplierService) {
        this.supplierService = supplierService;
    }

    @GetMapping
    public ApiResponse<SupplierListResponse> list(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Boolean isActive,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.ok(supplierService.list(search, isActive, page, limit));
    }

    /** Unpaginated, active-only — simple picker dropdowns (e.g. quotation creation). */
    @GetMapping("/all")
    public ApiResponse<List<SupplierResponse>> listAllActive() {
        return ApiResponse.ok(supplierService.listAllActive());
    }

    @PostMapping
    public ResponseEntity<ApiResponse<SupplierResponse>> create(@Valid @RequestBody SupplierRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(supplierService.create(req)));
    }

    @PatchMapping("/{id}")
    public ApiResponse<SupplierResponse> update(@PathVariable String id, @Valid @RequestBody SupplierRequest req) {
        return ApiResponse.ok(supplierService.update(id, req));
    }

    @GetMapping("/{id}/history")
    public ApiResponse<SupplierHistoryResponse> getHistory(@PathVariable String id) {
        return ApiResponse.ok(supplierService.getHistory(id));
    }
}
