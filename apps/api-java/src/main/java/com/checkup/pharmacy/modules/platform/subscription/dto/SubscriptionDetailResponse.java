package com.checkup.pharmacy.modules.platform.subscription.dto;

import com.checkup.pharmacy.modules.platform.tenant.dto.OwnerInfo;
import com.checkup.pharmacy.modules.platform.tenant.dto.SettingsInfo;

import java.time.Instant;

/** Full subscription record for the platform subscription drawer. */
public record SubscriptionDetailResponse(
        String id,
        String pharmacyId,
        String planName,
        String status,
        String billingCycle,
        Double amount,
        Instant validUntil,
        boolean autoRenew,
        double discount,
        String couponCode,
        double creditBalance,
        Instant trialEndsAt,
        Instant pausedAt,
        Instant cancelledAt,
        Instant createdAt,
        PharmacyRef pharmacy,
        OwnerInfo owner,
        Billing billing,
        UsageStatsResponse usage,
        SettingsInfo features) {

    public record PharmacyRef(String id, String name, String tenantCode, String gstin, String tenantStatus) {
    }

    public record Billing(
            InvoiceResponse lastInvoice,
            Instant nextInvoiceDate,
            double outstanding,
            String gstinPharmacy,
            String gstinPlatform,
            double discount,
            String couponCode,
            double creditBalance) {
    }
}
