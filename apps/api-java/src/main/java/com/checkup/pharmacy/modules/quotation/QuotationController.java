package com.checkup.pharmacy.modules.quotation;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.quotation.dto.CompareQuotationsRequest;
import com.checkup.pharmacy.modules.quotation.dto.CompareQuotationsResponse;
import com.checkup.pharmacy.modules.quotation.dto.ConvertToPoRequest;
import com.checkup.pharmacy.modules.quotation.dto.ConvertToPoResponse;
import com.checkup.pharmacy.modules.quotation.dto.CreateQuotationRequest;
import com.checkup.pharmacy.modules.quotation.dto.QuotationPageResponse;
import com.checkup.pharmacy.modules.quotation.dto.QuotationResponse;
import com.checkup.pharmacy.modules.quotation.dto.UpdateQuotationRequest;
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
 * Supplier quotations (RFQs) under /api/v1/quotations — tenant-scoped. Every
 * write (create, edit, status transitions, convert) is OWNER-only; reads and
 * price comparison are open to any authenticated staff member.
 */
@RestController
@RequestMapping("/api/v1/quotations")
public class QuotationController {

    private final QuotationService quotationService;

    public QuotationController(QuotationService quotationService) {
        this.quotationService = quotationService;
    }

    @GetMapping
    public ApiResponse<QuotationPageResponse> list(
            @RequestParam(required = false) String supplierId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.ok(quotationService.list(supplierId, status, from, to, page, limit));
    }

    @PostMapping
    @PreAuthorize("hasRole('OWNER')")
    public ResponseEntity<ApiResponse<QuotationResponse>> create(@Valid @RequestBody CreateQuotationRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(quotationService.create(req)));
    }

    @GetMapping("/{id}")
    public ApiResponse<QuotationResponse> getById(@PathVariable String id) {
        return ApiResponse.ok(quotationService.getById(id));
    }

    @PatchMapping("/{id}")
    @PreAuthorize("hasRole('OWNER')")
    public ApiResponse<QuotationResponse> update(@PathVariable String id, @Valid @RequestBody UpdateQuotationRequest req) {
        return ApiResponse.ok(quotationService.update(id, req));
    }

    @PatchMapping("/{id}/send")
    @PreAuthorize("hasRole('OWNER')")
    public ApiResponse<QuotationResponse> markSent(@PathVariable String id) {
        return ApiResponse.ok(quotationService.markSent(id));
    }

    @PatchMapping("/{id}/receive")
    @PreAuthorize("hasRole('OWNER')")
    public ApiResponse<QuotationResponse> markReceived(@PathVariable String id) {
        return ApiResponse.ok(quotationService.markReceived(id));
    }

    @PatchMapping("/{id}/expire")
    @PreAuthorize("hasRole('OWNER')")
    public ApiResponse<QuotationResponse> markExpired(@PathVariable String id) {
        return ApiResponse.ok(quotationService.markExpired(id));
    }

    @PostMapping("/compare")
    public ApiResponse<CompareQuotationsResponse> compare(@Valid @RequestBody CompareQuotationsRequest req) {
        return ApiResponse.ok(quotationService.compare(req.quotationIds()));
    }

    @PostMapping("/{id}/convert-to-po")
    @PreAuthorize("hasRole('OWNER')")
    public ResponseEntity<ApiResponse<ConvertToPoResponse>> convertToPo(@PathVariable String id,
                                                                        @Valid @RequestBody(required = false) ConvertToPoRequest req) {
        String notes = req == null ? null : req.notes();
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(quotationService.convertToPo(id, notes)));
    }
}
