package com.checkup.pharmacy.modules.platform.subscription.dto;

import com.checkup.pharmacy.modules.platform.domain.SubscriptionAuditLog;

import java.time.Instant;

/** One subscription audit-log entry ({@code /subscriptions/{id}/audit}). */
public record SubscriptionAuditResponse(
        String id,
        String subscriptionId,
        String action,
        String oldValue,
        String newValue,
        String performedBy,
        Instant createdAt) {

    public static SubscriptionAuditResponse from(SubscriptionAuditLog a) {
        return new SubscriptionAuditResponse(a.getId(), a.getSubscriptionId(), a.getAction(),
                a.getOldValue(), a.getNewValue(), a.getPerformedBy(), a.getCreatedAt());
    }
}
