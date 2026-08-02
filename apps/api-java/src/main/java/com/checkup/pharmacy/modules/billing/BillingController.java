package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.billing.dto.AddPaymentRequest;
import com.checkup.pharmacy.modules.billing.dto.CancelInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.CreateReturnRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoicePageResponse;
import com.checkup.pharmacy.modules.billing.dto.InvoiceResponse;
import com.checkup.pharmacy.modules.billing.dto.PaymentResponse;
import com.checkup.pharmacy.modules.billing.dto.RepeatCartResponse;
import com.checkup.pharmacy.modules.billing.dto.SalesReturnPageResponse;
import com.checkup.pharmacy.modules.billing.dto.SalesReturnResponse;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * POS billing under /api/v1/billing — tenant-scoped. Creating an invoice,
 * adding a payment, and raising a sales return are open to any authenticated
 * staff member (routine day-to-day POS operations); only cancelling an invoice
 * is OWNER-only, since it undoes a completed sale.
 */
@RestController
@RequestMapping("/api/v1/billing")
public class BillingController {

    private final BillingService billingService;

    public BillingController(BillingService billingService) {
        this.billingService = billingService;
    }

    @PostMapping
    public ResponseEntity<ApiResponse<InvoiceResponse>> createInvoice(@Valid @RequestBody CreateInvoiceRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(billingService.createInvoice(req)));
    }

    @GetMapping
    public ApiResponse<InvoicePageResponse> listInvoices(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "false") boolean includeCancelled,
            @RequestParam(required = false) String paymentMode,
            @RequestParam(required = false) String paymentStatus,
            @RequestParam(required = false) String userId,
            @RequestParam(required = false) String customerId,
            @RequestParam(required = false) BigDecimal minAmount,
            @RequestParam(required = false) BigDecimal maxAmount,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.ok(billingService.listInvoices(search, from, to, status, includeCancelled, paymentMode,
                paymentStatus, userId, customerId, minAmount, maxAmount, page, limit));
    }

    /** Homepage/Sales KPI cards — recomputed from live data each call (literal segment, resolves before /{id}). */
    @GetMapping("/dashboard/stats")
    public ApiResponse<com.checkup.pharmacy.modules.billing.dto.DashboardStatsResponse> dashboardStats() {
        return ApiResponse.ok(billingService.getDashboardStats());
    }

    /** Per-pharmacy invoice/GST/numbering config (JSON blob) — readable by any staff. */
    @GetMapping("/settings")
    public ApiResponse<com.fasterxml.jackson.databind.JsonNode> getSettings() {
        return ApiResponse.ok(billingService.getInvoiceSettings());
    }

    /** Save invoice settings — OWNER only (it governs how every bill prints and is numbered). */
    @PutMapping("/settings")
    @PreAuthorize("hasRole('OWNER')")
    public ApiResponse<com.fasterxml.jackson.databind.JsonNode> saveSettings(
            @RequestBody com.fasterxml.jackson.databind.JsonNode config) {
        return ApiResponse.ok(billingService.saveInvoiceSettings(config));
    }

    /**
     * Billing-screen action preferences (which save actions exist, pinned, order).
     *
     * <p>Readable by any staff member — every till renders its action bar from this.
     * Declared before {@code @GetMapping("/{id}")} so the literal path is unmistakable
     * even though Spring already prefers it over a path variable.
     */
    @GetMapping("/preferences")
    public ApiResponse<com.fasterxml.jackson.databind.JsonNode> getBillingPreferences() {
        return ApiResponse.ok(billingService.getBillingPreferences());
    }

    /**
     * Save billing preferences — OWNER/MANAGER. Shop-wide workflow config, so it sits
     * with the other pharmacy-profile writes rather than being OWNER-only like invoice
     * numbering, which carries legal weight.
     */
    @PutMapping("/preferences")
    @PreAuthorize("hasAnyRole('OWNER','MANAGER')")
    public ApiResponse<com.fasterxml.jackson.databind.JsonNode> saveBillingPreferences(
            @RequestBody com.fasterxml.jackson.databind.JsonNode config) {
        return ApiResponse.ok(billingService.saveBillingPreferences(config));
    }

    @GetMapping("/{id}")
    public ApiResponse<InvoiceResponse> getInvoice(@PathVariable String id) {
        return ApiResponse.ok(billingService.getInvoice(id));
    }

    @GetMapping("/repeat/{customerId}")
    public ApiResponse<RepeatCartResponse> repeatLastBill(@PathVariable String customerId) {
        return ApiResponse.ok(billingService.getRepeatCart(customerId));
    }

    @PatchMapping("/{id}/cancel")
    @PreAuthorize("hasRole('OWNER')")
    public ApiResponse<InvoiceResponse> cancelInvoice(@PathVariable String id, @Valid @RequestBody CancelInvoiceRequest req) {
        return ApiResponse.ok(billingService.cancelInvoice(id, req.reason()));
    }

    @PostMapping("/{id}/payments")
    public ResponseEntity<ApiResponse<PaymentResponse>> addPayment(@PathVariable String id, @Valid @RequestBody AddPaymentRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(billingService.addPayment(id, req)));
    }

    @GetMapping("/returns")
    public ApiResponse<SalesReturnPageResponse> listReturns(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(required = false) String invoiceId,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.ok(billingService.listReturns(search, from, to, invoiceId, page, limit));
    }

    @GetMapping("/returns/{returnId}")
    public ApiResponse<SalesReturnResponse> getReturn(@PathVariable String returnId) {
        return ApiResponse.ok(billingService.getReturn(returnId));
    }

    @PostMapping("/{id}/returns")
    public ResponseEntity<ApiResponse<SalesReturnResponse>> createReturn(@PathVariable String id, @Valid @RequestBody CreateReturnRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(billingService.createReturn(id, req)));
    }

    @GetMapping("/{id}/returns")
    public ApiResponse<SalesReturnPageResponse> listReturnsForInvoice(
            @PathVariable String id,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.ok(billingService.listReturns(null, null, null, id, page, limit));
    }
}
