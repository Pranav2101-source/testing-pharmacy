package com.checkup.pharmacy.modules.platform.subscription.dto;

import com.checkup.pharmacy.modules.platform.domain.Subscription;

import java.time.Instant;

/** Compact updated-subscription echo returned by the lifecycle actions (renew/pause/resume/cancel/plan). */
public record SubscriptionMutationResponse(
        String id,
        String pharmacyId,
        String planName,
        String status,
        String billingCycle,
        Double amount,
        Instant validUntil,
        boolean autoRenew) {

    public static SubscriptionMutationResponse from(Subscription s) {
        return new SubscriptionMutationResponse(s.getId(), s.getPharmacyId(), s.getPlanName(),
                s.getStatus() == null ? null : s.getStatus().name(), s.getBillingCycle(), s.getAmount(),
                s.getValidUntil(), s.isAutoRenew());
    }
}
