package com.checkup.pharmacy.modules.platform.subscription.dto;

import java.util.List;

/** Chart series for the subscriptions dashboard. renewal/churn carry {@code revenue} too (Node spread). */
public record SubscriptionChartsResponse(
        List<NameCount> planDistribution,
        List<NameCount> statusDistribution,
        List<MrrPoint> mrrTrend,
        List<RenewalPoint> renewalTrend,
        List<ChurnPoint> churnTrend) {

    public record NameCount(String name, long count) {
    }

    public record MrrPoint(String month, long revenue) {
    }

    public record RenewalPoint(String month, long revenue, int renewals) {
    }

    public record ChurnPoint(String month, long revenue, int churn) {
    }
}
