package com.checkup.pharmacy.modules.platform.subscription;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.platform.subscription.dto.BulkSubscriptionRequest;
import com.checkup.pharmacy.modules.platform.subscription.dto.ChangePlanRequest;
import com.checkup.pharmacy.modules.platform.subscription.dto.InvoiceResponse;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionAuditResponse;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionBulkResult;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionChartsResponse;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionDetailResponse;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionExportRow;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionListEnvelope;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionMutationResponse;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionStatsResponse;
import com.checkup.pharmacy.modules.platform.subscription.dto.UsageStatsResponse;
import com.checkup.pharmacy.security.UserPrincipal;
import com.checkup.pharmacy.tenant.TenantContext;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** Platform subscription management endpoints. Platform-admin only. */
@RestController
@RequestMapping("/api/v1/platform/subscriptions")
@PreAuthorize("hasRole('PLATFORM_ADMIN')")
public class SubscriptionController {

    private final SubscriptionService subscriptionService;

    public SubscriptionController(SubscriptionService subscriptionService) {
        this.subscriptionService = subscriptionService;
    }

    @GetMapping("/stats")
    public ApiResponse<SubscriptionStatsResponse> stats() {
        return ApiResponse.ok(subscriptionService.getStats());
    }

    @GetMapping("/charts")
    public ApiResponse<SubscriptionChartsResponse> charts() {
        return ApiResponse.ok(subscriptionService.getChartData());
    }

    @GetMapping
    public SubscriptionListEnvelope list(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String plan,
            @RequestParam(defaultValue = "ALL") String status,
            @RequestParam(defaultValue = "ALL") String billingCycle,
            @RequestParam(defaultValue = "ALL") String renewalWindow,
            @RequestParam(defaultValue = "ALL") String paymentStatus,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "25") int limit,
            @RequestParam(defaultValue = "createdAt") String sortBy,
            @RequestParam(defaultValue = "true") boolean sortDesc) {
        return subscriptionService.listSubscriptions(search, plan, status, billingCycle, renewalWindow,
                page, limit, sortBy, sortDesc);
    }

    @GetMapping("/export")
    public ApiResponse<List<SubscriptionExportRow>> export(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String plan,
            @RequestParam(defaultValue = "ALL") String status) {
        return ApiResponse.ok(subscriptionService.exportSubscriptions(search, plan, status));
    }

    @PostMapping("/bulk")
    public ApiResponse<SubscriptionBulkResult> bulk(@Valid @RequestBody BulkSubscriptionRequest req) {
        return ApiResponse.ok(subscriptionService.bulkAction(req.ids(), req.action(), actorId(), req.planName()));
    }

    @GetMapping("/{id}")
    public ApiResponse<SubscriptionDetailResponse> detail(@PathVariable String id) {
        return ApiResponse.ok(subscriptionService.getDetail(id));
    }

    @PatchMapping("/{id}/plan")
    public ApiResponse<SubscriptionMutationResponse> changePlan(@PathVariable String id,
                                                                @Valid @RequestBody ChangePlanRequest req) {
        return ApiResponse.ok(subscriptionService.changePlan(id, req.planName(), req.billingCycle(), req.amount(),
                actorId()));
    }

    @PostMapping("/{id}/renew")
    public ApiResponse<SubscriptionMutationResponse> renew(@PathVariable String id) {
        return ApiResponse.ok(subscriptionService.renew(id, actorId()));
    }

    @PostMapping("/{id}/pause")
    public ApiResponse<SubscriptionMutationResponse> pause(@PathVariable String id) {
        return ApiResponse.ok(subscriptionService.pause(id, actorId()));
    }

    @PostMapping("/{id}/resume")
    public ApiResponse<SubscriptionMutationResponse> resume(@PathVariable String id) {
        return ApiResponse.ok(subscriptionService.resume(id, actorId()));
    }

    @PostMapping("/{id}/cancel")
    public ApiResponse<SubscriptionMutationResponse> cancel(@PathVariable String id) {
        return ApiResponse.ok(subscriptionService.cancel(id, actorId()));
    }

    @PostMapping("/{id}/reminder")
    public ApiResponse<Map<String, Object>> reminder(@PathVariable String id) {
        return ApiResponse.ok(subscriptionService.sendReminder(id, actorId()));
    }

    @PostMapping("/{id}/invoice")
    public ApiResponse<InvoiceResponse> generateInvoice(@PathVariable String id) {
        return ApiResponse.ok(subscriptionService.generateInvoice(id, actorId()));
    }

    @GetMapping("/{id}/invoices")
    public ApiResponse<List<InvoiceResponse>> invoices(@PathVariable String id) {
        return ApiResponse.ok(subscriptionService.getInvoices(id));
    }

    @GetMapping("/{id}/usage")
    public ApiResponse<UsageStatsResponse> usage(@PathVariable String id) {
        return ApiResponse.ok(subscriptionService.getUsage(id));
    }

    @GetMapping("/{id}/audit")
    public ApiResponse<List<SubscriptionAuditResponse>> audit(@PathVariable String id) {
        return ApiResponse.ok(subscriptionService.getAuditLog(id));
    }

    private static String actorId() {
        UserPrincipal actor = TenantContext.currentUser();
        return actor.userId();
    }
}
