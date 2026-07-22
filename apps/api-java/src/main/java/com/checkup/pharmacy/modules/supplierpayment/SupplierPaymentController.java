package com.checkup.pharmacy.modules.supplierpayment;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.supplierpayment.dto.CreatePaymentRequest;
import com.checkup.pharmacy.modules.supplierpayment.dto.OutstandingResponse;
import com.checkup.pharmacy.modules.supplierpayment.dto.PaymentPageResponse;
import com.checkup.pharmacy.modules.supplierpayment.dto.PaymentResponse;
import com.checkup.pharmacy.modules.supplierpayment.dto.SupplierBalanceResponse;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;

/**
 * Supplier payments under /api/v1/supplier-payments — tenant-scoped. Recording a
 * payment is OWNER-only since it moves the supplier ledger balance; reads are
 * open to any authenticated staff member.
 */
@RestController
@RequestMapping("/api/v1/supplier-payments")
public class SupplierPaymentController {

    private final SupplierPaymentService supplierPaymentService;

    public SupplierPaymentController(SupplierPaymentService supplierPaymentService) {
        this.supplierPaymentService = supplierPaymentService;
    }

    @GetMapping
    public ApiResponse<PaymentPageResponse> list(
            @RequestParam(required = false) String supplierId,
            @RequestParam(required = false) String grnId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.ok(supplierPaymentService.list(supplierId, grnId, from, to, page, limit));
    }

    @PostMapping
    @PreAuthorize("hasRole('OWNER')")
    public ResponseEntity<ApiResponse<PaymentResponse>> create(@Valid @RequestBody CreatePaymentRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(supplierPaymentService.create(req)));
    }

    /** Payables across all suppliers. Static segment — registered ahead of /{id} by Spring's most-specific-match routing. */
    @GetMapping("/outstanding")
    public ApiResponse<OutstandingResponse> listOutstanding() {
        return ApiResponse.ok(supplierPaymentService.listOutstanding());
    }

    @GetMapping("/{id}")
    public ApiResponse<PaymentResponse> getById(@PathVariable String id) {
        return ApiResponse.ok(supplierPaymentService.getById(id));
    }

    @GetMapping("/balance/{supplierId}")
    public ApiResponse<SupplierBalanceResponse> getSupplierBalance(@PathVariable String supplierId) {
        return ApiResponse.ok(supplierPaymentService.getSupplierBalance(supplierId));
    }
}
