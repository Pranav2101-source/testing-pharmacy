package com.checkup.pharmacy.modules.platform.subscription.dto;

/** The 13 KPIs on the subscriptions dashboard header. Matches the Node {@code getStats()} output. */
public record SubscriptionStatsResponse(
        long mrr,
        long arr,
        long todaysRevenue,
        long monthlyRevenue,
        long renewalsThisMonth,
        long outstanding,
        int collectionRate,
        long arpt,
        long activeSubs,
        long trialSubs,
        long expiringSoon,
        long expiredSubs,
        double churnRate) {
}
