package com.checkup.pharmacy.modules.purchase;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.purchase.dto.ApprovePurchaseOrderRequest;
import com.checkup.pharmacy.modules.purchase.dto.CreateGrnRequest;
import com.checkup.pharmacy.modules.purchase.dto.CreatePurchaseOrderRequest;
import com.checkup.pharmacy.modules.purchase.dto.GrnPageResponse;
import com.checkup.pharmacy.modules.purchase.dto.GrnResponse;
import com.checkup.pharmacy.modules.purchase.dto.PurchaseOrderPageResponse;
import com.checkup.pharmacy.modules.purchase.dto.PurchaseOrderResponse;
import com.checkup.pharmacy.modules.purchase.dto.UpdateGrnRequest;
import com.checkup.pharmacy.modules.purchase.dto.UpdatePurchaseOrderRequest;
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
import java.util.List;

/**
 * Purchase orders and GRNs under /api/v1/purchases — tenant-scoped. Any
 * authenticated staff member can raise a PO (PHARMACIST-raised orders land as
 * PENDING_APPROVAL). PO status transitions (approve/send/cancel) are
 * OWNER-only, since they commit spend to a supplier. GRN writes (Gate Inward)
 * are OWNER/MANAGER/PHARMACIST — day-to-day goods receipt shouldn't need the
 * owner in the room, since only confirmGrn actually moves stock/ledger and
 * updateGrn/cancelGrn only ever touch an unconfirmed DRAFT.
 */
@RestController
@RequestMapping("/api/v1/purchases")
public class PurchasesController {

    private final PurchasesService purchasesService;

    public PurchasesController(PurchasesService purchasesService) {
        this.purchasesService = purchasesService;
    }

    // ── Purchase Orders ──────────────────────────────────────────────────────

    @GetMapping("/orders")
    public ApiResponse<PurchaseOrderPageResponse> listPOs(
            @RequestParam(required = false) List<String> status,
            @RequestParam(required = false) String approvalStatus,
            @RequestParam(required = false) String supplierId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.ok(purchasesService.listPOs(status, approvalStatus, supplierId, from, to, search, page, limit));
    }

    @PostMapping("/orders")
    public ResponseEntity<ApiResponse<PurchaseOrderResponse>> createPO(@Valid @RequestBody CreatePurchaseOrderRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(purchasesService.createPO(req)));
    }

    /** Generates a DRAFT PO from a selection of reorder suggestions — same shape/rules as a plain PO. */
    @PostMapping("/orders/from-reorder")
    public ResponseEntity<ApiResponse<PurchaseOrderResponse>> createPOFromReorder(@Valid @RequestBody CreatePurchaseOrderRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(purchasesService.createPO(req)));
    }

    @GetMapping("/suggestions")
    public ApiResponse<List<com.checkup.pharmacy.modules.purchase.dto.ReorderSuggestionResponse>> getReorderSuggestions(
            @RequestParam(defaultValue = "30") int daysThreshold) {
        return ApiResponse.ok(purchasesService.getReorderSuggestions(daysThreshold));
    }

    @GetMapping("/orders/{id}")
    public ApiResponse<PurchaseOrderResponse> getPOById(@PathVariable String id) {
        return ApiResponse.ok(purchasesService.getPOById(id));
    }

    @PatchMapping("/orders/{id}")
    public ApiResponse<PurchaseOrderResponse> updatePO(@PathVariable String id, @Valid @RequestBody UpdatePurchaseOrderRequest req) {
        return ApiResponse.ok(purchasesService.updatePO(id, req));
    }

    @PatchMapping("/orders/{id}/approve")
    @PreAuthorize("hasRole('OWNER')")
    public ApiResponse<PurchaseOrderResponse> approvePO(@PathVariable String id, @Valid @RequestBody ApprovePurchaseOrderRequest req) {
        return ApiResponse.ok(purchasesService.approvePO(id, req));
    }

    @PatchMapping("/orders/{id}/send")
    @PreAuthorize("hasRole('OWNER')")
    public ApiResponse<PurchaseOrderResponse> sendPO(@PathVariable String id) {
        return ApiResponse.ok(purchasesService.sendPO(id));
    }

    @DeleteMapping("/orders/{id}")
    @PreAuthorize("hasRole('OWNER')")
    public ApiResponse<PurchaseOrderResponse> cancelPO(@PathVariable String id) {
        return ApiResponse.ok(purchasesService.cancelPO(id));
    }

    // ── GRN ──────────────────────────────────────────────────────────────────

    @GetMapping("/grn")
    public ApiResponse<GrnPageResponse> listGrns(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String supplierId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(defaultValue = "false") boolean overdue,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.ok(purchasesService.listGrns(status, supplierId, from, to, overdue, page, limit));
    }

    @PostMapping("/grn")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER', 'PHARMACIST')")
    public ResponseEntity<ApiResponse<GrnResponse>> createGrn(@Valid @RequestBody CreateGrnRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(purchasesService.createGrn(req)));
    }

    @GetMapping("/grn/{id}")
    public ApiResponse<GrnResponse> getGrnById(@PathVariable String id) {
        return ApiResponse.ok(purchasesService.getGrnById(id));
    }

    @PatchMapping("/grn/{id}")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER', 'PHARMACIST')")
    public ApiResponse<GrnResponse> updateGrn(@PathVariable String id, @Valid @RequestBody UpdateGrnRequest req) {
        return ApiResponse.ok(purchasesService.updateGrn(id, req));
    }

    @PatchMapping("/grn/{id}/confirm")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER', 'PHARMACIST')")
    public ApiResponse<GrnResponse> confirmGrn(@PathVariable String id) {
        return ApiResponse.ok(purchasesService.confirmGrn(id));
    }

    @DeleteMapping("/grn/{id}")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER', 'PHARMACIST')")
    public ApiResponse<GrnResponse> cancelGrn(@PathVariable String id) {
        return ApiResponse.ok(purchasesService.cancelGrn(id));
    }
}
