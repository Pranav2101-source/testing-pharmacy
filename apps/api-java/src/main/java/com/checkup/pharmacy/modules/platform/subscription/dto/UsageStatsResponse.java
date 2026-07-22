package com.checkup.pharmacy.modules.platform.subscription.dto;

/**
 * Per-tenant resource usage vs. plan limits. Served both embedded in the
 * subscription detail and standalone at {@code /subscriptions/{id}/usage}.
 * {@code used}/{@code limit} are nullable where the dimension isn't metered
 * (e.g. storage used, api usage), matching the Node shape the drawer reads.
 */
public record UsageStatsResponse(
        UsageMetric doctors,
        UsageMetric patients,
        UsageMetric staff,
        UsageMetric storage,
        UsageMetric prescriptions,
        UsageMetric documents,
        UsageMetric invoices,
        UsageMetric apiUsage) {

    public record UsageMetric(Long used, Integer limit) {
    }
}
