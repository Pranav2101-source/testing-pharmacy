package com.checkup.pharmacy.modules.platform.analytics;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.enums.SubscriptionStatus;
import com.checkup.pharmacy.modules.platform.analytics.dto.ActivityListResponse;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.ActivePharmacy;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.ActivityItem;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.AgentCount;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.CategoryCount;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.Churn;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.ChurnPoint;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.CriticalAlert;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.FeatureUsage;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.Geographic;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.Health;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.KpiCard;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.NewPharmaPoint;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.PlanCountRevenue;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.PlanRevenue;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.PriorityCount;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.Renewals;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.Revenue;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.RevenueGrowthPoint;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.StateInsight;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.StateRevenue;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.StatusCount;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.SubscriptionAnalytics;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.Support;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.TenantGrowth;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.TicketTrendPoint;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.TopDoctor;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.TopListEntry;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.TopLists;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse.Usage;
import com.checkup.pharmacy.modules.platform.analytics.dto.NewPharmaciesResponse;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.platform.domain.Subscription;
import com.checkup.pharmacy.modules.platform.domain.SubscriptionRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import com.checkup.pharmacy.config.CacheConfig;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Platform analytics dashboard. Ported from the deleted Node
 * {@code analytics.service.ts}. Read-only cross-tenant aggregation done via JPQL
 * through the {@link EntityManager} (same pattern as {@code ReportsService}).
 *
 * The Node original kept a 60s in-memory cache of the assembled dashboard; that's
 * a latency optimization, not part of the contract, and is omitted here (the
 * dashboard recomputes per request). A few blocks carry Node's own placeholder
 * values (search=null without Meilisearch, seeded most-active/top-doctors, fixed
 * autoRenewPct/api metrics) — preserved for shape parity and flagged inline.
 */
@Service
public class AnalyticsService {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter LABEL = DateTimeFormatter.ofPattern("MMM d", Locale.US);
    private static final long DAY_MS = 86_400_000L;
    private static final Map<String, String> PLAN_COLORS = Map.of(
            "Free", "slate", "Standard", "blue", "Professional", "purple", "Enterprise", "emerald");

    private final EntityManager em;
    private final RedisConnectionFactory redisConnectionFactory;
    private final UserRepository userRepository;
    private final SubscriptionRepository subscriptionRepository;

    public AnalyticsService(EntityManager em, RedisConnectionFactory redisConnectionFactory,
                            UserRepository userRepository, SubscriptionRepository subscriptionRepository) {
        this.em = em;
        this.redisConnectionFactory = redisConnectionFactory;
        this.userRepository = userRepository;
        this.subscriptionRepository = subscriptionRepository;
    }

    // ── Dashboard ─────────────────────────────────────────────────────────────

    /**
     * Cached for {@code app.cache.analytics-ttl-seconds} (default 5 minutes).
     *
     * <p>This method runs thirteen aggregate sections. Uncached, every dashboard
     * open — and every browser refresh — replays all of them against a pool of five
     * connections shared with billing, so a platform admin watching this page can
     * measurably slow the till in a live pharmacy. Platform-wide metrics do not
     * change meaningfully minute to minute, which makes this the cheapest large
     * win available on database load.
     *
     * <p>Keyed on the date range so different windows do not collide. Safe to cache
     * globally rather than per tenant: this is platform-scoped data behind a
     * PLATFORM_ADMIN-only route, not a per-pharmacy view.
     */
    @Cacheable(cacheNames = CacheConfig.ANALYTICS_DASHBOARD,
               key = "#from + ':' + #to",
               unless = "#result == null")
    @Transactional(readOnly = true)
    public AnalyticsDashboardResponse getDashboard(Instant from, Instant to) {
        return new AnalyticsDashboardResponse(
                executiveKpis(from, to),
                criticalAlerts(),
                revenueAnalytics(from, to),
                tenantGrowth(from, to),
                subscriptionAnalytics(),
                churnAnalytics(from, to),
                productUsage(from, to),
                null, // search: no Meilisearch stats integration (Node returned null when unavailable)
                supportAnalytics(from, to),
                systemHealth(),
                geographicInsights(),
                recentActivity(20),
                topLists());
    }

    @Transactional(readOnly = true)
    public ActivityListResponse getActivity() {
        List<ActivityItem> items = recentActivity(20);
        return new ActivityListResponse(items, items.size());
    }

    private List<KpiCard> executiveKpis(Instant from, Instant to) {
        Instant previousFrom = from.minusMillis(to.toEpochMilli() - from.toEpochMilli());
        Instant previousTo = from;

        long activePharmacies = count("SELECT COUNT(p) FROM Pharmacy p WHERE p.isActive = true AND p.createdAt <= :to",
                Map.of("to", to));
        long prevActivePharmacies = count(
                "SELECT COUNT(p) FROM Pharmacy p WHERE p.isActive = true AND p.createdAt <= :to",
                Map.of("to", previousTo));
        long newPharmacies = count("SELECT COUNT(p) FROM Pharmacy p WHERE p.createdAt >= :from AND p.createdAt <= :to",
                Map.of("from", from, "to", to));
        long prevNewPharmacies = count(
                "SELECT COUNT(p) FROM Pharmacy p WHERE p.createdAt >= :from AND p.createdAt <= :to",
                Map.of("from", previousFrom, "to", previousTo));
        long activeDoctors = count("SELECT COUNT(d) FROM Doctor d WHERE d.isActive = true AND d.createdAt <= :to",
                Map.of("to", to));
        long prevActiveDoctors = count("SELECT COUNT(d) FROM Doctor d WHERE d.isActive = true AND d.createdAt <= :to",
                Map.of("to", previousTo));
        long activePatients = count("SELECT COUNT(c) FROM Customer c WHERE c.createdAt <= :to", Map.of("to", to));
        long prevActivePatients = count("SELECT COUNT(c) FROM Customer c WHERE c.createdAt <= :to",
                Map.of("to", previousTo));
        long totalPrescriptions = count(
                "SELECT COUNT(r) FROM Prescription r WHERE r.createdAt >= :from AND r.createdAt <= :to",
                Map.of("from", from, "to", to));
        long prevPrescriptions = count(
                "SELECT COUNT(r) FROM Prescription r WHERE r.createdAt >= :from AND r.createdAt <= :to",
                Map.of("from", previousFrom, "to", previousTo));
        long openTickets = count("""
                SELECT COUNT(t) FROM SupportTicket t
                WHERE CAST(t.status AS string) NOT IN ('RESOLVED', 'CLOSED') AND t.createdAt <= :to
                """, Map.of("to", to));
        long prevOpenTickets = count("""
                SELECT COUNT(t) FROM SupportTicket t
                WHERE CAST(t.status AS string) NOT IN ('RESOLVED', 'CLOSED') AND t.createdAt <= :to
                """, Map.of("to", previousTo));

        List<Object[]> activeSubs = rows("""
                SELECT s.amount, s.billingCycle, s.createdAt FROM Subscription s
                WHERE CAST(s.status AS string) IN ('ACTIVE', 'TRIAL')
                """, Map.of());
        List<Object[]> prevActiveSubs = rows("""
                SELECT s.amount, s.billingCycle FROM Subscription s
                WHERE CAST(s.status AS string) IN ('ACTIVE', 'TRIAL') AND s.createdAt <= :to
                """, Map.of("to", previousTo));

        long mrr = Math.round(mrrOf(activeSubs));
        long arr = mrr * 12;
        long prevMrr = Math.round(mrrOf(prevActiveSubs));
        long prevArr = prevMrr * 12;

        List<Double> pharmaSpark = sparkline(createdAts("Pharmacy", from, to), from, to);
        List<Double> docSpark = sparkline(createdAts("Doctor", from, to), from, to);
        List<Double> patSpark = sparkline(createdAts("Customer", from, to), from, to);
        List<Double> rxSpark = sparkline(createdAts("Prescription", from, to), from, to);
        List<Double> tktSpark = sparkline(createdAts("SupportTicket", from, to), from, to);
        List<Double> mrrSpark = mrrSparkline(activeSubs, from, to, mrr);
        List<Double> arrSpark = mrrSpark.stream().map(v -> v * 12).toList();
        List<Double> uptimeSpark = List.of(99.9, 99.9, 99.9, 99.9, 99.9, 99.9, 99.9);

        List<KpiCard> cards = new ArrayList<>();
        cards.add(new KpiCard("mrr", "Monthly Recurring Revenue", mrr, Long.toString(mrr), calcChange(mrr, prevMrr),
                "vs previous period", mrrSpark, "/dashboard/subscriptions"));
        cards.add(new KpiCard("arr", "Annual Recurring Revenue", arr, Long.toString(arr), calcChange(arr, prevArr),
                "vs previous period", arrSpark, "/dashboard/subscriptions"));
        cards.add(new KpiCard("pharmacies", "Active Pharmacies", activePharmacies, Long.toString(activePharmacies),
                calcChange(activePharmacies, prevActivePharmacies), "vs previous period", pharmaSpark,
                "/dashboard/tenants?status=ACTIVE"));
        cards.add(new KpiCard("newPharmacies", "New Pharmacies", newPharmacies, Long.toString(newPharmacies),
                calcChange(newPharmacies, prevNewPharmacies), "vs previous period", pharmaSpark, "/dashboard/tenants"));
        cards.add(new KpiCard("doctors", "Active Doctors", activeDoctors, Long.toString(activeDoctors),
                calcChange(activeDoctors, prevActiveDoctors), "vs previous period", docSpark, "/dashboard/tenants"));
        cards.add(new KpiCard("patients", "Active Patients", activePatients, Long.toString(activePatients),
                calcChange(activePatients, prevActivePatients), "vs previous period", patSpark, null));
        cards.add(new KpiCard("prescriptions", "Total Prescriptions", totalPrescriptions,
                Long.toString(totalPrescriptions), calcChange(totalPrescriptions, prevPrescriptions),
                "vs previous period", rxSpark, null));
        cards.add(new KpiCard("tickets", "Open Support Tickets", openTickets, Long.toString(openTickets),
                calcChange(openTickets, prevOpenTickets), "vs previous period", tktSpark, "/dashboard/support?status=OPEN"));
        cards.add(new KpiCard("uptime", "System Uptime", 99.9, "99.9%", 0, "vs previous period", uptimeSpark, null));
        return cards;
    }

    private List<CriticalAlert> criticalAlerts() {
        Instant now = Instant.now();
        Instant tomorrow = now.plusMillis(DAY_MS);
        List<CriticalAlert> alerts = new ArrayList<>();
        long expiringSubs = count("""
                SELECT COUNT(s) FROM Subscription s
                WHERE CAST(s.status AS string) = 'ACTIVE' AND s.validUntil >= :now AND s.validUntil <= :tomorrow
                """, Map.of("now", now, "tomorrow", tomorrow));
        if (expiringSubs > 0) {
            alerts.add(new CriticalAlert("subs-expire", "WARNING",
                    expiringSubs + " subscriptions expire within 24h", "subscription"));
        }
        long urgentTickets = count("""
                SELECT COUNT(t) FROM SupportTicket t
                WHERE CAST(t.status AS string) IN ('OPEN', 'ASSIGNED') AND CAST(t.priority AS string) = 'URGENT'
                """, Map.of());
        if (urgentTickets > 0) {
            alerts.add(new CriticalAlert("urgent-tickets", "CRITICAL",
                    urgentTickets + " open urgent tickets", "support"));
        }
        return alerts;
    }

    private Revenue revenueAnalytics(Instant from, Instant to) {
        List<PlanRevenue> byPlan = rows("""
                SELECT s.planName, COUNT(s), COALESCE(SUM(s.amount), 0) FROM Subscription s
                WHERE CAST(s.status AS string) = 'ACTIVE' GROUP BY s.planName
                """, Map.of()).stream()
                .map(r -> new PlanRevenue((String) r[0], ((Number) r[2]).doubleValue(), ((Number) r[1]).longValue()))
                .toList();

        Map<String, double[]> stateMap = new LinkedHashMap<>(); // [revenue, count]
        for (Object[] r : rows("""
                SELECT COALESCE(p.state, 'Unknown'), COALESCE(s.amount, 0) FROM Pharmacy p
                LEFT JOIN Subscription s ON s.pharmacyId = p.id WHERE p.isActive = true
                """, Map.of())) {
            double[] agg = stateMap.computeIfAbsent((String) r[0], k -> new double[2]);
            agg[0] += ((Number) r[1]).doubleValue();
            agg[1] += 1;
        }
        List<StateRevenue> byState = stateMap.entrySet().stream()
                .map(e -> new StateRevenue(e.getKey(), e.getValue()[0], (long) e.getValue()[1])).toList();

        List<Object[]> activeSubs = rows("""
                SELECT s.amount, s.billingCycle, s.createdAt FROM Subscription s
                WHERE CAST(s.status AS string) IN ('ACTIVE', 'TRIAL')
                """, Map.of());
        long msPerInterval = (to.toEpochMilli() - from.toEpochMilli()) / 5;
        List<RevenueGrowthPoint> revenueGrowth = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            Instant intervalDate = from.plusMillis(msPerInterval * i);
            double mrr = 0;
            for (Object[] s : activeSubs) {
                Instant created = (Instant) s[2];
                if (!created.isAfter(intervalDate)) {
                    mrr += tenantMrr((Double) s[0], (String) s[1]);
                }
            }
            long m = Math.round(mrr);
            revenueGrowth.add(new RevenueGrowthPoint(label(intervalDate), m, m * 12, Math.round(mrr * 1.1)));
        }
        return new Revenue(revenueGrowth, byPlan, byState);
    }

    private TenantGrowth tenantGrowth(Instant from, Instant to) {
        List<StatusCount> statusDistribution = rows(
                "SELECT CAST(p.tenantStatus AS string), COUNT(p) FROM Pharmacy p GROUP BY p.tenantStatus", Map.of())
                .stream().map(r -> new StatusCount((String) r[0], ((Number) r[1]).longValue())).toList();

        List<Instant> created = createdAts("Pharmacy", from, to);
        long msPerInterval = (to.toEpochMilli() - from.toEpochMilli()) / 5;
        List<NewPharmaPoint> newPharmacies = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            long intStart = from.toEpochMilli() + msPerInterval * i;
            long intEnd = from.toEpochMilli() + msPerInterval * (i + 1);
            long c = created.stream().filter(d -> d.toEpochMilli() >= intStart && d.toEpochMilli() < intEnd).count();
            newPharmacies.add(new NewPharmaPoint(label(Instant.ofEpochMilli(intEnd)), c));
        }
        return new TenantGrowth(newPharmacies, statusDistribution);
    }

    private SubscriptionAnalytics subscriptionAnalytics() {
        Instant now = Instant.now();
        Instant in7 = now.plusMillis(7 * DAY_MS);
        Instant in30 = now.plusMillis(30 * DAY_MS);
        long expiring7 = count("""
                SELECT COUNT(s) FROM Subscription s
                WHERE CAST(s.status AS string) = 'ACTIVE' AND s.validUntil >= :now AND s.validUntil <= :in7
                """, Map.of("now", now, "in7", in7));
        long expiring30 = count("""
                SELECT COUNT(s) FROM Subscription s
                WHERE CAST(s.status AS string) = 'ACTIVE' AND s.validUntil >= :now AND s.validUntil <= :in30
                """, Map.of("now", now, "in30", in30));
        long expired = count("SELECT COUNT(s) FROM Subscription s WHERE CAST(s.status AS string) = 'EXPIRED'", Map.of());
        long cancelled = count("SELECT COUNT(s) FROM Subscription s WHERE CAST(s.status AS string) = 'CANCELLED'",
                Map.of());
        long totalInvoices = count("SELECT COUNT(i) FROM SubscriptionInvoice i", Map.of());
        long paidInvoices = count("SELECT COUNT(i) FROM SubscriptionInvoice i WHERE CAST(i.status AS string) = 'PAID'",
                Map.of());
        double outstanding = sum("""
                SELECT COALESCE(SUM(i.total), 0) FROM SubscriptionInvoice i
                WHERE CAST(i.status AS string) IN ('PENDING', 'OVERDUE')
                """, Map.of());

        List<PlanCountRevenue> planDistribution = rows("""
                SELECT s.planName, COUNT(s), COALESCE(SUM(s.amount), 0) FROM Subscription s
                WHERE CAST(s.status AS string) = 'ACTIVE' GROUP BY s.planName
                """, Map.of()).stream()
                .map(r -> new PlanCountRevenue((String) r[0], ((Number) r[1]).longValue(), ((Number) r[2]).doubleValue()))
                .toList();

        int collectionRate = totalInvoices > 0 ? (int) Math.round((double) paidInvoices / totalInvoices * 100) : 100;

        // Computed, not invented. This was a literal 85 carried over from the Node
        // implementation's "Not tracked in DB yet" placeholder — but the autoRenew
        // column does exist and always has, so the dashboard was showing a plausible
        // fabricated number to the people using it to make retention decisions.
        // A wrong number nobody can distinguish from a right one is worse than a
        // missing one.
        long activeSubs = subscriptionRepository.countByStatus(SubscriptionStatus.ACTIVE);
        long autoRenewSubs = subscriptionRepository.countByStatusAndAutoRenewTrue(SubscriptionStatus.ACTIVE);
        int autoRenewPct = activeSubs > 0
                ? (int) Math.round((double) autoRenewSubs / activeSubs * 100)
                : 0;

        return new SubscriptionAnalytics(planDistribution,
                new Renewals(expiring7, expiring30, expired, cancelled), collectionRate, outstanding, autoRenewPct);
    }

    private Churn churnAnalytics(Instant from, Instant to) {
        Map<String, Object> range = Map.of("from", from, "to", to);
        long cancelled = count("""
                SELECT COUNT(s) FROM Subscription s
                WHERE CAST(s.status AS string) = 'CANCELLED' AND s.updatedAt >= :from AND s.updatedAt <= :to
                """, range);
        long suspended = count("""
                SELECT COUNT(p) FROM Pharmacy p
                WHERE CAST(p.tenantStatus AS string) = 'SUSPENDED' AND p.updatedAt >= :from AND p.updatedAt <= :to
                """, range);
        double lostRevenue = sum("""
                SELECT COALESCE(SUM(s.amount), 0) FROM Subscription s
                WHERE CAST(s.status AS string) = 'CANCELLED' AND s.updatedAt >= :from AND s.updatedAt <= :to
                """, range);
        long totalSubs = count("SELECT COUNT(s) FROM Subscription s WHERE s.createdAt <= :to", Map.of("to", to));
        double churnRate = totalSubs > 0 ? Math.round((double) cancelled / totalSubs * 10000.0) / 100.0 : 0;

        List<Object[]> cancelledSubs = rows("""
                SELECT s.updatedAt FROM Subscription s
                WHERE CAST(s.status AS string) = 'CANCELLED' AND s.updatedAt >= :from AND s.updatedAt <= :to
                """, range);
        long msPerInterval = (to.toEpochMilli() - from.toEpochMilli()) / 5;
        List<ChurnPoint> churnTrend = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            long intStart = from.toEpochMilli() + msPerInterval * i;
            long intEnd = from.toEpochMilli() + msPerInterval * (i + 1);
            long c = cancelledSubs.stream().map(r -> (Instant) r[0])
                    .filter(d -> d != null && d.toEpochMilli() >= intStart && d.toEpochMilli() < intEnd).count();
            churnTrend.add(new ChurnPoint(label(Instant.ofEpochMilli(intEnd)), c));
        }
        return new Churn(cancelled, suspended, lostRevenue, churnRate, churnTrend);
    }

    private Usage productUsage(Instant from, Instant to) {
        Map<String, Object> range = Map.of("from", from, "to", to);
        long invoices = count("SELECT COUNT(i) FROM Invoice i WHERE i.createdAt >= :from AND i.createdAt <= :to", range);
        long prescriptions = count(
                "SELECT COUNT(r) FROM Prescription r WHERE r.createdAt >= :from AND r.createdAt <= :to", range);
        long customers = count("SELECT COUNT(c) FROM Customer c WHERE c.createdAt >= :from AND c.createdAt <= :to", range);
        // mostActivePharmacies / topDoctors are Node seed rows (illustrative, not queried).
        return new Usage(
                List.of(new ActivePharmacy("1", "Apollo", 1500)),
                List.of(new TopDoctor("1", "Dr. Smith", "Apollo", 300)),
                List.of(new FeatureUsage("Invoices", invoices), new FeatureUsage("Prescriptions", prescriptions),
                        new FeatureUsage("Customers Added", customers)));
    }

    private Support supportAnalytics(Instant from, Instant to) {
        Map<String, Object> range = Map.of("from", from, "to", to);
        long open = count(
                "SELECT COUNT(t) FROM SupportTicket t WHERE CAST(t.status AS string) NOT IN ('RESOLVED', 'CLOSED')",
                Map.of());
        List<CategoryCount> byCategory = rows("""
                SELECT t.categoryId, COUNT(t) FROM SupportTicket t
                WHERE t.createdAt >= :from AND t.createdAt <= :to GROUP BY t.categoryId
                """, range).stream()
                .map(r -> new CategoryCount((String) r[0], ((Number) r[1]).longValue())).toList();
        List<PriorityCount> byPriority = rows("""
                SELECT CAST(t.priority AS string), COUNT(t) FROM SupportTicket t
                WHERE t.createdAt >= :from AND t.createdAt <= :to GROUP BY t.priority
                """, range).stream()
                .map(r -> new PriorityCount((String) r[0], ((Number) r[1]).longValue())).toList();
        List<AgentCount> byAgent = rows("""
                SELECT t.assignedAgentId, COUNT(t) FROM SupportTicket t
                WHERE t.createdAt >= :from AND t.createdAt <= :to AND t.assignedAgentId IS NOT NULL
                GROUP BY t.assignedAgentId
                """, range).stream()
                .map(r -> new AgentCount((String) r[0], ((Number) r[1]).longValue())).toList();

        List<Object[]> allTix = rows(
                "SELECT t.createdAt, CAST(t.status AS string) FROM SupportTicket t WHERE t.createdAt >= :from AND t.createdAt <= :to",
                range);
        long msPerInterval = (to.toEpochMilli() - from.toEpochMilli()) / 5;
        List<TicketTrendPoint> ticketTrend = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            long intStart = from.toEpochMilli() + msPerInterval * i;
            long intEnd = from.toEpochMilli() + msPerInterval * (i + 1);
            long opened = 0;
            long resolved = 0;
            for (Object[] t : allTix) {
                long ms = ((Instant) t[0]).toEpochMilli();
                if (ms >= intStart && ms < intEnd) {
                    opened++;
                    String st = (String) t[1];
                    if ("RESOLVED".equals(st) || "CLOSED".equals(st)) {
                        resolved++;
                    }
                }
            }
            ticketTrend.add(new TicketTrendPoint(label(Instant.ofEpochMilli(intEnd)), opened, resolved));
        }
        // avgResolutionTimeHours is 0 until resolvedAt-based timing is implemented (Node placeholder).
        return new Support(open, 0, byCategory, byPriority, byAgent, ticketTrend);
    }

    private Health systemHealth() {
        long latency = 0;
        double sizeGb = 0;
        try {
            long start = System.currentTimeMillis();
            Object size = em.createNativeQuery("SELECT pg_database_size(current_database())").getSingleResult();
            latency = System.currentTimeMillis() - start;
            sizeGb = ((Number) size).doubleValue() / (1024.0 * 1024 * 1024);
        } catch (Exception ignored) {
            // leave defaults
        }
        boolean redisUp;
        try {
            redisConnectionFactory.getConnection().ping();
            redisUp = true;
        } catch (Exception e) {
            redisUp = false;
        }
        Object[] uploads = rows("SELECT COALESCE(SUM(u.fileSize), 0), COUNT(u) FROM Upload u", Map.of()).get(0);
        long usedMb = Math.round(((Number) uploads[0]).doubleValue() / (1024.0 * 1024));
        long fileCount = ((Number) uploads[1]).longValue();

        return new Health(
                new Health.Db(latency < 100 ? "HEALTHY" : "WARNING", latency, Math.round(sizeGb * 100) / 100.0),
                new Health.Redis(redisUp ? "HEALTHY" : "OFFLINE", redisUp),
                new Health.Queue("HEALTHY", 0, 0, 0),
                new Health.Api(0, 0),
                new Health.BackgroundJobs(0, 0, 0),
                new Health.Storage(usedMb, fileCount));
    }

    private Geographic geographicInsights() {
        Map<String, double[]> stateMap = new LinkedHashMap<>(); // [pharmacies, revenue, doctors]
        for (Object[] r : rows("""
                SELECT COALESCE(p.state, 'Unknown'), COALESCE(s.amount, 0),
                       (SELECT COUNT(d) FROM Doctor d WHERE d.pharmacyId = p.id)
                FROM Pharmacy p LEFT JOIN Subscription s ON s.pharmacyId = p.id WHERE p.isActive = true
                """, Map.of())) {
            double[] agg = stateMap.computeIfAbsent((String) r[0], k -> new double[3]);
            agg[0] += 1;
            agg[1] += ((Number) r[1]).doubleValue();
            agg[2] += ((Number) r[2]).doubleValue();
        }
        List<StateInsight> byState = stateMap.entrySet().stream()
                .map(e -> new StateInsight(e.getKey(), (long) e.getValue()[0], e.getValue()[1], (long) e.getValue()[2]))
                .toList();
        return new Geographic(byState);
    }

    private List<ActivityItem> recentActivity(int limit) {
        Query q = em.createQuery(
                "SELECT p.id, p.name, p.createdAt FROM Pharmacy p ORDER BY p.createdAt DESC");
        q.setMaxResults(limit);
        @SuppressWarnings("unchecked")
        List<Object[]> rs = q.getResultList();
        List<ActivityItem> items = new ArrayList<>(rs.size());
        for (Object[] r : rs) {
            items.add(new ActivityItem((String) r[0], "PHARMACY_CREATED",
                    "New Pharmacy registered: " + r[1], String.valueOf(r[2])));
        }
        return items;
    }

    private TopLists topLists() {
        Query rq = em.createQuery("""
                SELECT s.amount, p.id, p.name FROM Subscription s JOIN s.pharmacy p
                WHERE CAST(s.status AS string) = 'ACTIVE' AND s.amount > 0 ORDER BY s.amount DESC
                """);
        rq.setMaxResults(5);
        @SuppressWarnings("unchecked")
        List<Object[]> topRevenueRows = rq.getResultList();
        List<TopListEntry> topRevenue = new ArrayList<>();
        for (int i = 0; i < topRevenueRows.size(); i++) {
            Object[] r = topRevenueRows.get(i);
            topRevenue.add(new TopListEntry(i + 1, (String) r[1], (String) r[2],
                    r[0] == null ? 0 : ((Number) r[0]).doubleValue(), null));
        }

        Query dq = em.createQuery("""
                SELECT d.id, d.name, ph.name, (SELECT COUNT(pr) FROM Prescription pr WHERE pr.doctorId = d.id)
                FROM Doctor d LEFT JOIN Pharmacy ph ON ph.id = d.pharmacyId
                ORDER BY (SELECT COUNT(pr) FROM Prescription pr WHERE pr.doctorId = d.id) DESC
                """);
        dq.setMaxResults(5);
        @SuppressWarnings("unchecked")
        List<Object[]> topDoctorRows = dq.getResultList();
        List<TopListEntry> topDoctors = new ArrayList<>();
        for (int i = 0; i < topDoctorRows.size(); i++) {
            Object[] r = topDoctorRows.get(i);
            topDoctors.add(new TopListEntry(i + 1, (String) r[0], (String) r[1],
                    ((Number) r[3]).doubleValue(), r[2] == null ? "" : (String) r[2]));
        }
        return new TopLists(topRevenue, List.of(), List.of(), topDoctors, List.of());
    }

    // ── New-pharmacies drilldown ──────────────────────────────────────────────

    @Transactional(readOnly = true)
    public NewPharmaciesResponse getNewPharmacies(int days, int page, int limit, String search, String plan,
                                                  String status, String sort) {
        Instant from = Instant.now().minusMillis((long) days * DAY_MS);
        Map<String, Object> filterParams = new java.util.HashMap<>();
        String filter = buildPharmaFilter(search, plan, status, from, filterParams);

        long totalUnfiltered = count("SELECT COUNT(p) FROM Pharmacy p WHERE p.createdAt >= :from",
                Map.of("from", from));
        long active = countByStatus(from, "ACTIVE");
        long suspended = countByStatus(from, "SUSPENDED");
        long archived = countByStatus(from, "ARCHIVED");
        long totalFiltered = count("SELECT COUNT(p) FROM Pharmacy p WHERE 1=1" + filter, filterParams);

        String order = switch (sort == null ? "" : sort) {
            case "oldest" -> "p.createdAt ASC, p.id DESC";
            case "alphabetical" -> "p.name ASC, p.id DESC";
            default -> "p.createdAt DESC, p.id DESC";
        };
        Query q = em.createQuery("SELECT p FROM Pharmacy p WHERE 1=1" + filter + " ORDER BY " + order);
        filterParams.forEach(q::setParameter);
        q.setFirstResult((Math.max(page, 1) - 1) * limit);
        q.setMaxResults(limit);
        @SuppressWarnings("unchecked")
        List<Pharmacy> pharmacies = q.getResultList();

        Map<String, User> owners = new java.util.HashMap<>();
        Map<String, Subscription> subs = new java.util.HashMap<>();
        if (!pharmacies.isEmpty()) {
            List<String> ids = pharmacies.stream().map(Pharmacy::getId).toList();
            userRepository.findByPharmacyIdInAndRole(ids, Role.OWNER).forEach(u -> owners.putIfAbsent(u.getPharmacyId(), u));
            subscriptionRepository.findByPharmacyIdIn(ids).forEach(s -> subs.put(s.getPharmacyId(), s));
        }

        List<NewPharmaciesResponse.Item> items = new ArrayList<>(pharmacies.size());
        for (Pharmacy p : pharmacies) {
            User owner = owners.get(p.getId());
            Subscription sub = subs.get(p.getId());
            String planName = sub == null ? "Free" : sub.getPlanName();
            items.add(new NewPharmaciesResponse.Item(p.getId(), p.getLogoUrl(), p.getName(), p.getTenantCode(),
                    owner == null ? "--" : owner.getName(), owner == null ? "--" : owner.getEmail(),
                    new NewPharmaciesResponse.Plan(planName, PLAN_COLORS.getOrDefault(planName, "slate")),
                    String.valueOf(p.getCreatedAt()),
                    p.getTenantStatus() == null ? null : p.getTenantStatus().name()));
        }

        int totalPages = (int) Math.ceil((double) totalFiltered / limit);
        return new NewPharmaciesResponse(
                new NewPharmaciesResponse.Summary(totalUnfiltered, active, suspended, archived),
                new NewPharmaciesResponse.Pagination(page, limit, totalPages, totalFiltered),
                items);
    }

    // ── Exports ───────────────────────────────────────────────────────────────

    public record ExportPayload(byte[] content, String filename, String contentType) {
    }

    @Transactional(readOnly = true)
    public ExportPayload exportDashboardData(Instant from, Instant to, String format) {
        Map<String, Object> range = Map.of("from", from, "to", to);
        double revenue = sum("""
                SELECT COALESCE(SUM(i.total), 0) FROM SubscriptionInvoice i
                WHERE CAST(i.status AS string) = 'PAID' AND i.paidAt >= :from AND i.paidAt <= :to
                """, range);
        long newPharmacies = count("SELECT COUNT(p) FROM Pharmacy p WHERE p.createdAt >= :from AND p.createdAt <= :to",
                range);
        long doctors = count("SELECT COUNT(d) FROM Doctor d WHERE d.createdAt >= :from AND d.createdAt <= :to", range);
        long patients = count("SELECT COUNT(c) FROM Customer c WHERE c.createdAt >= :from AND c.createdAt <= :to", range);
        long prescriptions = count(
                "SELECT COUNT(r) FROM Prescription r WHERE r.createdAt >= :from AND r.createdAt <= :to", range);
        long tickets = count("SELECT COUNT(t) FROM SupportTicket t WHERE t.createdAt >= :from AND t.createdAt <= :to",
                range);

        String dateStr = from.toString().substring(0, 10) + "_to_" + to.toString().substring(0, 10);
        if ("xlsx".equals(format)) {
            StringBuilder h = new StringBuilder();
            h.append("<html xmlns:o=\"urn:schemas-microsoft-com:office:office\" ")
                    .append("xmlns:x=\"urn:schemas-microsoft-com:office:excel\" ")
                    .append("xmlns=\"http://www.w3.org/TR/REC-html40\"><head><meta charset=\"utf-8\" /></head><body>");
            h.append("<h2>Platform Analytics Export</h2><p>Date Range (IST): ").append(from).append(" to ").append(to)
                    .append("</p><table border=\"1\"><tr><th>Metric</th><th>Value</th></tr>");
            h.append(xlsRow("Total Revenue Generated", revenue));
            h.append(xlsRow("New Pharmacies Created", newPharmacies));
            h.append(xlsRow("Doctors Registered", doctors));
            h.append(xlsRow("Patients Registered", patients));
            h.append(xlsRow("Prescriptions Created", prescriptions));
            h.append(xlsRow("Support Tickets Raised", tickets));
            h.append("</table></body></html>");
            return new ExportPayload(h.toString().getBytes(StandardCharsets.UTF_8),
                    "PlatformAnalytics_" + dateStr + ".xls", "application/vnd.ms-excel");
        }
        StringBuilder sb = new StringBuilder();
        sb.append("Platform Analytics Export\n");
        sb.append("Date Range (IST): ").append(from).append(" to ").append(to).append("\n\n");
        sb.append("Metric,Value\n");
        sb.append("\"Total Revenue Generated\",\"").append((long) revenue).append("\"\n");
        sb.append("\"New Pharmacies Created\",\"").append(newPharmacies).append("\"\n");
        sb.append("\"Doctors Registered\",\"").append(doctors).append("\"\n");
        sb.append("\"Patients Registered\",\"").append(patients).append("\"\n");
        sb.append("\"Prescriptions Created\",\"").append(prescriptions).append("\"\n");
        sb.append("\"Support Tickets Raised\",\"").append(tickets).append("\"\n");
        return new ExportPayload(sb.toString().getBytes(StandardCharsets.UTF_8),
                "PlatformAnalytics_" + dateStr + ".csv", "text/csv");
    }

    @Transactional(readOnly = true)
    public ExportPayload exportNewPharmacies(int days, String search, String plan, String status, String sort) {
        Instant from = Instant.now().minusMillis((long) days * DAY_MS);
        Map<String, Object> filterParams = new java.util.HashMap<>();
        String filter = buildPharmaFilter(search, plan, status, from, filterParams);
        String order = switch (sort == null ? "" : sort) {
            case "oldest" -> "p.createdAt ASC, p.id DESC";
            case "alphabetical" -> "p.name ASC, p.id DESC";
            default -> "p.createdAt DESC, p.id DESC";
        };
        Query q = em.createQuery("SELECT p FROM Pharmacy p WHERE 1=1" + filter + " ORDER BY " + order);
        filterParams.forEach(q::setParameter);
        q.setMaxResults(50_000);
        @SuppressWarnings("unchecked")
        List<Pharmacy> pharmacies = q.getResultList();

        Map<String, User> owners = new java.util.HashMap<>();
        Map<String, Subscription> subs = new java.util.HashMap<>();
        if (!pharmacies.isEmpty()) {
            List<String> ids = pharmacies.stream().map(Pharmacy::getId).toList();
            userRepository.findByPharmacyIdInAndRole(ids, Role.OWNER).forEach(u -> owners.putIfAbsent(u.getPharmacyId(), u));
            subscriptionRepository.findByPharmacyIdIn(ids).forEach(s -> subs.put(s.getPharmacyId(), s));
        }

        StringBuilder sb = new StringBuilder();
        sb.append("Pharmacy Name,Tenant Code,Owner Name,Owner Email,Plan,Created Date,Status\n");
        for (Pharmacy p : pharmacies) {
            User owner = owners.get(p.getId());
            Subscription sub = subs.get(p.getId());
            String planName = sub == null ? "Free" : sub.getPlanName();
            sb.append(csv(p.getName())).append(',')
                    .append(p.getTenantCode() == null ? "--" : p.getTenantCode()).append(',')
                    .append(csv(owner == null ? "--" : owner.getName())).append(',')
                    .append(owner == null ? "--" : owner.getEmail()).append(',')
                    .append(planName).append(',')
                    .append(p.getCreatedAt()).append(',')
                    .append(p.getTenantStatus() == null ? "" : p.getTenantStatus().name()).append('\n');
        }
        return new ExportPayload(sb.toString().getBytes(StandardCharsets.UTF_8),
                "NewPharmacies_Export_" + Instant.now().toString().substring(0, 10) + ".csv", "text/csv");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private String buildPharmaFilter(String search, String plan, String status, Instant from,
                                     Map<String, Object> params) {
        StringBuilder f = new StringBuilder(" AND p.createdAt >= :from");
        params.put("from", from);
        if (search != null && !search.isBlank()) {
            f.append(" AND (LOWER(p.name) LIKE :search OR LOWER(COALESCE(p.tenantCode, '')) LIKE :search")
                    .append(" OR EXISTS (SELECT u FROM User u WHERE u.pharmacyId = p.id")
                    .append(" AND CAST(u.role AS string) = 'OWNER' AND LOWER(COALESCE(u.name, '')) LIKE :search))");
            params.put("search", "%" + search.toLowerCase() + "%");
        }
        if (status != null && !status.isBlank()) {
            f.append(" AND CAST(p.tenantStatus AS string) = :status");
            params.put("status", status);
        }
        if (plan != null && !plan.isBlank()) {
            f.append(" AND EXISTS (SELECT s FROM Subscription s WHERE s.pharmacyId = p.id AND s.planName = :plan)");
            params.put("plan", plan);
        }
        return f.toString();
    }

    private long countByStatus(Instant from, String status) {
        return count("SELECT COUNT(p) FROM Pharmacy p WHERE p.createdAt >= :from AND CAST(p.tenantStatus AS string) = :status",
                Map.of("from", from, "status", status));
    }

    private List<Instant> createdAts(String entity, Instant from, Instant to) {
        Query q = em.createQuery(
                "SELECT e.createdAt FROM " + entity + " e WHERE e.createdAt >= :from AND e.createdAt <= :to");
        q.setParameter("from", from);
        q.setParameter("to", to);
        @SuppressWarnings("unchecked")
        List<Instant> list = q.getResultList();
        return list;
    }

    private static List<Double> sparkline(List<Instant> createdAts, Instant from, Instant to) {
        long days = Math.max(7, (long) Math.ceil((to.toEpochMilli() - from.toEpochMilli()) / (double) DAY_MS));
        long interval = (long) Math.ceil(days / 7.0);
        double[] buckets = new double[7];
        for (Instant d : createdAts) {
            if (!d.isBefore(from) && !d.isAfter(to)) {
                int idx = (int) Math.min(6, (d.toEpochMilli() - from.toEpochMilli()) / (DAY_MS * interval));
                buckets[idx] += 1;
            }
        }
        return toList(buckets);
    }

    private static List<Double> mrrSparkline(List<Object[]> activeSubs, Instant from, Instant to, long mrr) {
        long days = Math.max(7, (long) Math.ceil((to.toEpochMilli() - from.toEpochMilli()) / (double) DAY_MS));
        long interval = (long) Math.ceil(days / 7.0);
        double[] buckets = new double[7];
        for (Object[] s : activeSubs) {
            Instant d = (Instant) s[2];
            if (!d.isBefore(from) && !d.isAfter(to)) {
                int idx = (int) Math.min(6, (d.toEpochMilli() - from.toEpochMilli()) / (DAY_MS * interval));
                double mrrAdd = tenantMrr((Double) s[0], (String) s[1]);
                for (int i = idx; i < 7; i++) {
                    buckets[i] += mrrAdd;
                }
            }
        }
        double baseMrr = mrr - buckets[6];
        List<Double> out = new ArrayList<>(7);
        for (double b : buckets) {
            out.add(b + baseMrr);
        }
        return out;
    }

    private static List<Double> toList(double[] arr) {
        List<Double> out = new ArrayList<>(arr.length);
        for (double v : arr) {
            out.add(v);
        }
        return out;
    }

    private static double mrrOf(List<Object[]> rows) {
        double mrr = 0;
        for (Object[] r : rows) {
            mrr += tenantMrr((Double) r[0], (String) r[1]);
        }
        return mrr;
    }

    private static double tenantMrr(Double amount, String cycle) {
        double amt = amount == null ? 0 : amount;
        return switch (cycle == null ? "MONTHLY" : cycle) {
            case "YEARLY" -> amt / 12;
            case "QUARTERLY" -> amt / 3;
            default -> amt;
        };
    }

    private static long calcChange(long curr, long prev) {
        if (prev == 0) {
            return curr > 0 ? 100 : 0;
        }
        return Math.round((double) (curr - prev) / prev * 100);
    }

    private static String label(Instant t) {
        return LABEL.format(t.atZone(IST));
    }

    private long count(String jpql, Map<String, Object> params) {
        Query q = em.createQuery(jpql);
        params.forEach(q::setParameter);
        return ((Number) q.getSingleResult()).longValue();
    }

    private double sum(String jpql, Map<String, Object> params) {
        Query q = em.createQuery(jpql);
        params.forEach(q::setParameter);
        Object r = q.getSingleResult();
        return r == null ? 0 : ((Number) r).doubleValue();
    }

    private List<Object[]> rows(String jpql, Map<String, Object> params) {
        Query q = em.createQuery(jpql);
        params.forEach(q::setParameter);
        @SuppressWarnings("unchecked")
        List<Object[]> list = q.getResultList();
        return list;
    }

    private static String xlsRow(String metric, Number value) {
        return "<tr><td>" + metric + "</td><td>" + (value instanceof Double ? (long) value.doubleValue() : value)
                + "</td></tr>";
    }

    private static String csv(String value) {
        return com.checkup.pharmacy.common.util.CsvField.escape(value);
    }
}
