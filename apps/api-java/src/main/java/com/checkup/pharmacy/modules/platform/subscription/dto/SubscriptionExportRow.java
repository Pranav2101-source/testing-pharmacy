package com.checkup.pharmacy.modules.platform.subscription.dto;

/** One row of the subscriptions export (returned as a JSON array the frontend renders/downloads). */
public record SubscriptionExportRow(
        String tenantCode,
        String pharmacy,
        String owner,
        String ownerEmail,
        String plan,
        String billingCycle,
        double amount,
        String status,
        String autoRenew,
        String validUntil,
        String gstin,
        String createdAt) {
}
