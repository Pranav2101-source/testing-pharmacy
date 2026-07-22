package com.checkup.pharmacy.modules.platform.tenant.dto;

import com.checkup.pharmacy.common.enums.TenantStatus;

import java.time.Instant;
import java.util.List;

/**
 * Flat wire envelope for {@code GET /platform/tenants} — {@code {success, data, meta}},
 * NOT the standard {@link com.checkup.pharmacy.common.api.ApiResponse} shape, because
 * the frontend's {@code TenantsResponse} reads {@code data} and {@code meta} as sibling
 * top-level keys (a legacy contract, same style as the doctors list).
 */
public record TenantListEnvelope(boolean success, List<Item> data, Meta meta) {

    public static TenantListEnvelope of(List<Item> data, Meta meta) {
        return new TenantListEnvelope(true, data, meta);
    }

    public record Item(
            String id,
            String tenantCode,
            String name,
            String slug,
            String logoUrl,
            String state,
            String city,
            boolean isActive,
            TenantStatus tenantStatus,
            Instant createdAt,
            long doctorsCount,
            long patientsCount,
            OwnerInfo owner,
            SubscriptionInfo subscription) {
    }

    public record Meta(long total, int page, int limit, int totalPages) {
    }
}
