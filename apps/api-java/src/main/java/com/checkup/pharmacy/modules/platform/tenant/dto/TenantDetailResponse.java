package com.checkup.pharmacy.modules.platform.tenant.dto;

import com.checkup.pharmacy.common.enums.TenantStatus;

import java.time.Instant;

/** Full tenant record for the platform tenant drawer ({@code GET /platform/tenants/{id}}). */
public record TenantDetailResponse(
        String id,
        String tenantCode,
        String name,
        String slug,
        String gstin,
        String drugLicense,
        String phone,
        String email,
        String address,
        String city,
        String state,
        String pincode,
        boolean isActive,
        TenantStatus tenantStatus,
        Instant createdAt,
        OwnerInfo owner,
        SubscriptionInfo subscription,
        SettingsInfo tenantSettings,
        long doctorsCount,
        long patientsCount,
        long ticketsCount) {
}
