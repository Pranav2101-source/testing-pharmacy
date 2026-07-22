package com.checkup.pharmacy.modules.platform.tenant.dto;

import com.checkup.pharmacy.modules.platform.domain.Subscription;

import java.time.Instant;

/** Subscription summary embedded in tenant list/detail/create responses. */
public record SubscriptionInfo(
        String planName,
        String status,
        String billingCycle,
        Double amount,
        Instant validUntil,
        Boolean autoRenew) {

    public static SubscriptionInfo from(Subscription s) {
        if (s == null) {
            return null;
        }
        return new SubscriptionInfo(s.getPlanName(), s.getStatus() == null ? null : s.getStatus().name(),
                s.getBillingCycle(), s.getAmount(), s.getValidUntil(), s.isAutoRenew());
    }
}
