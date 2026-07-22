package com.checkup.pharmacy.modules.platform.analytics.dto;

import java.util.List;

/**
 * The platform analytics dashboard payload. The nested shape mirrors the Node
 * {@code AnalyticsDashboard} type verbatim — the frontend renders every section
 * by these exact keys. Some sub-sections carry Node's original placeholder/mock
 * values (e.g. autoRenewPct, api metrics, most-active/top-doctors seeds); those
 * are called out where they occur in {@code AnalyticsService}.
 */
public record AnalyticsDashboardResponse(
        List<KpiCard> executive,
        List<CriticalAlert> alerts,
        Revenue revenue,
        TenantGrowth tenants,
        SubscriptionAnalytics subscriptions,
        Churn churn,
        Usage usage,
        Search search,
        Support support,
        Health health,
        Geographic geographic,
        List<ActivityItem> activity,
        TopLists topLists) {

    public record KpiCard(String key, String label, double value, String formattedValue, long change,
                          String changeLabel, List<Double> sparkline, String to) {
    }

    public record CriticalAlert(String id, String severity, String message, String category) {
    }

    public record Revenue(List<RevenueGrowthPoint> revenueGrowth, List<PlanRevenue> byPlan, List<StateRevenue> byState) {
    }

    public record RevenueGrowthPoint(String date, long mrr, long arr, long revenue) {
    }

    public record PlanRevenue(String plan, double revenue, long count) {
    }

    public record StateRevenue(String state, double revenue, long pharmacyCount) {
    }

    public record TenantGrowth(List<NewPharmaPoint> newPharmacies, List<StatusCount> statusDistribution) {
    }

    public record NewPharmaPoint(String date, long count) {
    }

    public record StatusCount(String status, long count) {
    }

    public record SubscriptionAnalytics(List<PlanCountRevenue> planDistribution, Renewals renewals,
                                        int collectionRate, double outstandingRevenue, int autoRenewPct) {
    }

    public record PlanCountRevenue(String plan, long count, double revenue) {
    }

    public record Renewals(long expiringIn7Days, long expiringIn30Days, long expired, long cancelled) {
    }

    public record Churn(long cancelledSubscriptions, long suspendedPharmacies, double lostRevenue, double churnRate,
                        List<ChurnPoint> churnTrend) {
    }

    public record ChurnPoint(String date, long churned) {
    }

    public record Usage(List<ActivePharmacy> mostActivePharmacies, List<TopDoctor> topDoctors,
                        List<FeatureUsage> featureUsage) {
    }

    public record ActivePharmacy(String id, String name, long invoiceCount) {
    }

    public record TopDoctor(String id, String name, String pharmacyName, long prescriptionCount) {
    }

    public record FeatureUsage(String feature, long count) {
    }

    /** Null when Meilisearch stats are unavailable (matches Node's nullable search block). */
    public record Search(long totalSearches, long avgLatency, List<IndexStat> indexStats) {
    }

    public record IndexStat(String name, long documents) {
    }

    public record Support(long openTickets, double avgResolutionTimeHours, List<CategoryCount> byCategory,
                          List<PriorityCount> byPriority, List<AgentCount> byAgent, List<TicketTrendPoint> ticketTrend) {
    }

    public record CategoryCount(String category, long count) {
    }

    public record PriorityCount(String priority, long count) {
    }

    public record AgentCount(String agent, long count) {
    }

    public record TicketTrendPoint(String date, long opened, long resolved) {
    }

    public record Health(Db database, Redis redis, Queue queue, Api api, BackgroundJobs backgroundJobs,
                         Storage storage) {

        public record Db(String status, long latencyMs, double sizeGb) {
        }

        public record Redis(String status, boolean connected) {
        }

        public record Queue(String status, long waiting, long active, long failed) {
        }

        public record Api(long avgLatencyMs, long requestsPerMin) {
        }

        public record BackgroundJobs(long completed, long failed, long queued) {
        }

        public record Storage(long usedMb, long fileCount) {
        }
    }

    public record Geographic(List<StateInsight> byState) {
    }

    public record StateInsight(String state, long pharmacies, double revenue, long doctors) {
    }

    public record ActivityItem(String id, String type, String message, String timestamp) {
    }

    public record TopLists(List<TopListEntry> topRevenue, List<TopListEntry> topActive, List<TopListEntry> topSupport,
                           List<TopListEntry> topDoctors, List<TopListEntry> topGrowing) {
    }

    public record TopListEntry(int rank, String id, String name, double value, String subtitle) {
    }
}
