package com.checkup.pharmacy.modules.platform.subscription.dto;

import com.checkup.pharmacy.modules.platform.tenant.dto.OwnerInfo;

import java.time.Instant;
import java.util.List;

/**
 * Flat wire envelope for {@code GET /platform/subscriptions} — {@code {success, data, meta}},
 * matching the frontend's {@code SubscriptionsResponse} (siblings, not the standard
 * {@link com.checkup.pharmacy.common.api.ApiResponse}).
 */
public record SubscriptionListEnvelope(boolean success, List<Row> data, Meta meta) {

    public static SubscriptionListEnvelope of(List<Row> data, Meta meta) {
        return new SubscriptionListEnvelope(true, data, meta);
    }

    public record Row(
            String id,
            String pharmacyId,
            TenantRef tenant,
            OwnerInfo owner,
            String planName,
            long mrr,
            String billingCycle,
            Double amount,
            String status,
            Instant validUntil,
            boolean autoRenew,
            String paymentStatus,
            int usagePercent,
            String health,
            Instant createdAt) {
    }

    public record TenantRef(String name, String tenantCode) {
    }

    public record Meta(long total, int page, int limit, int totalPages) {
    }
}
