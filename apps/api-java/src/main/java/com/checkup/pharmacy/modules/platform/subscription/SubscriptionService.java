package com.checkup.pharmacy.modules.platform.subscription;

import com.checkup.pharmacy.common.enums.AuditModule;
import com.checkup.pharmacy.common.enums.AuditSeverity;
import com.checkup.pharmacy.common.enums.InvoicePaymentStatus;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.enums.SubscriptionStatus;
import com.checkup.pharmacy.common.enums.TenantStatus;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.audit.AuditEntry;
import com.checkup.pharmacy.modules.audit.AuditService;
import com.checkup.pharmacy.modules.billing.InvoiceRepository;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
import com.checkup.pharmacy.modules.doctor.DoctorRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.platform.domain.Subscription;
import com.checkup.pharmacy.modules.platform.domain.SubscriptionAuditLog;
import com.checkup.pharmacy.modules.platform.domain.SubscriptionAuditLogRepository;
import com.checkup.pharmacy.modules.platform.domain.SubscriptionInvoice;
import com.checkup.pharmacy.modules.platform.domain.SubscriptionInvoiceRepository;
import com.checkup.pharmacy.modules.platform.domain.SubscriptionRepository;
import com.checkup.pharmacy.modules.platform.domain.TenantSettings;
import com.checkup.pharmacy.modules.platform.domain.TenantSettingsRepository;
import com.checkup.pharmacy.modules.platform.subscription.dto.InvoiceResponse;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionAuditResponse;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionBulkResult;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionChartsResponse;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionChartsResponse.ChurnPoint;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionChartsResponse.MrrPoint;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionChartsResponse.NameCount;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionChartsResponse.RenewalPoint;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionDetailResponse;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionExportRow;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionListEnvelope;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionMutationResponse;
import com.checkup.pharmacy.modules.platform.subscription.dto.SubscriptionStatsResponse;
import com.checkup.pharmacy.modules.platform.subscription.dto.UsageStatsResponse;
import com.checkup.pharmacy.modules.platform.subscription.dto.UsageStatsResponse.UsageMetric;
import com.checkup.pharmacy.modules.platform.tenant.PlanPricing;
import com.checkup.pharmacy.modules.platform.tenant.dto.OwnerInfo;
import com.checkup.pharmacy.modules.platform.tenant.dto.SettingsInfo;
import com.checkup.pharmacy.modules.prescription.PrescriptionRepository;
import com.checkup.pharmacy.modules.upload.UploadRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.springframework.context.annotation.Lazy;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Platform subscription management. Ported from the deleted Node
 * {@code subscriptions.service.ts}. Cross-tenant (platform-admin surface).
 *
 * A {@code @Lazy} self-reference is injected so {@link #bulkAction} can invoke the
 * per-subscription lifecycle methods <em>through the Spring proxy</em>: a plain
 * {@code this.renew(...)} would be self-invocation and skip the {@code @Transactional}
 * advice, so one item's writes wouldn't be atomic and one failure couldn't be
 * isolated from the rest of the batch.
 */
@Service
public class SubscriptionService {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter MONTH_KEY = DateTimeFormatter.ofPattern("yyyy-MM");
    private static final DateTimeFormatter ISO_DATE = DateTimeFormatter.ISO_LOCAL_DATE;
    private static final String PLATFORM_GSTIN = "29AABCU9603R1ZM";
    private static final double GST_RATE = 0.18;
    private static final int INVOICE_DUE_DAYS = 15;

    private final SubscriptionRepository subscriptionRepository;
    private final SubscriptionInvoiceRepository invoiceRepository;
    private final SubscriptionAuditLogRepository auditLogRepository;
    private final TenantSettingsRepository tenantSettingsRepository;
    private final UserRepository userRepository;
    private final DoctorRepository doctorRepository;
    private final CustomerRepository customerRepository;
    private final PrescriptionRepository prescriptionRepository;
    private final InvoiceRepository billingInvoiceRepository;
    private final UploadRepository uploadRepository;
    private final AuditService auditService;
    private final ObjectMapper objectMapper;
    private final EntityManager entityManager;
    private final SubscriptionService self;

    public SubscriptionService(SubscriptionRepository subscriptionRepository,
                               SubscriptionInvoiceRepository invoiceRepository,
                               SubscriptionAuditLogRepository auditLogRepository,
                               TenantSettingsRepository tenantSettingsRepository, UserRepository userRepository,
                               DoctorRepository doctorRepository, CustomerRepository customerRepository,
                               PrescriptionRepository prescriptionRepository, InvoiceRepository billingInvoiceRepository,
                               UploadRepository uploadRepository, AuditService auditService, ObjectMapper objectMapper,
                               EntityManager entityManager, @Lazy SubscriptionService self) {
        this.subscriptionRepository = subscriptionRepository;
        this.invoiceRepository = invoiceRepository;
        this.auditLogRepository = auditLogRepository;
        this.tenantSettingsRepository = tenantSettingsRepository;
        this.userRepository = userRepository;
        this.doctorRepository = doctorRepository;
        this.customerRepository = customerRepository;
        this.prescriptionRepository = prescriptionRepository;
        this.billingInvoiceRepository = billingInvoiceRepository;
        this.uploadRepository = uploadRepository;
        this.auditService = auditService;
        this.objectMapper = objectMapper;
        this.entityManager = entityManager;
        this.self = self;
    }

    // ── Stats ───────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public SubscriptionStatsResponse getStats() {
        Instant now = Instant.now();
        Instant in30 = now.plus(30, ChronoUnit.DAYS);
        Instant thirtyDaysAgo = now.minus(30, ChronoUnit.DAYS);
        ZonedDateTime nowIst = now.atZone(IST);
        Instant startOfMonth = nowIst.toLocalDate().withDayOfMonth(1).atStartOfDay(IST).toInstant();
        Instant startOfNextMonth = nowIst.toLocalDate().withDayOfMonth(1).plusMonths(1).atStartOfDay(IST).toInstant();

        long allSubs = subscriptionRepository.count();
        long activeSubs = subscriptionRepository.countByStatus(SubscriptionStatus.ACTIVE);
        long trialSubs = subscriptionRepository.countByStatus(SubscriptionStatus.TRIAL);
        long expiringSoon = subscriptionRepository.countByStatusAndValidUntilBetween(SubscriptionStatus.ACTIVE, now, in30);
        long expiredSubs = subscriptionRepository.countByStatus(SubscriptionStatus.EXPIRED);
        long renewalsThisMonth = subscriptionRepository.countByValidUntilBetween(startOfMonth, startOfNextMonth);
        long totalInvoices = invoiceRepository.count();
        long paidInvoices = invoiceRepository.countByStatus(InvoicePaymentStatus.PAID);
        double monthlyRevenue = invoiceRepository.sumPaidTotalSince(startOfMonth);
        double outstanding = invoiceRepository.sumOutstanding();
        long recentlyExpired =
                subscriptionRepository.countByStatusAndUpdatedAtGreaterThanEqual(SubscriptionStatus.EXPIRED, thirtyDaysAgo);

        double mrr = mrrOf(subscriptionRepository.findActiveTrialAmountsAndCycles());
        double arr = mrr * 12;
        int collectionRate = totalInvoices > 0 ? (int) Math.round((double) paidInvoices / totalInvoices * 100) : 100;
        long arpt = activeSubs > 0 ? Math.round(mrr / activeSubs) : 0;
        double churnRate = allSubs > 0 ? Math.round((double) recentlyExpired / allSubs * 1000.0) / 10.0 : 0;

        return new SubscriptionStatsResponse(Math.round(mrr), Math.round(arr), 0, Math.round(monthlyRevenue),
                renewalsThisMonth, Math.round(outstanding), collectionRate, arpt, activeSubs, trialSubs,
                expiringSoon, expiredSubs, churnRate);
    }

    // ── Charts ──────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public SubscriptionChartsResponse getChartData() {
        List<NameCount> planDist = subscriptionRepository.planDistribution().stream()
                .map(r -> new NameCount((String) r[0], ((Number) r[1]).longValue())).toList();
        List<NameCount> statusDist = subscriptionRepository.statusDistribution().stream()
                .map(r -> new NameCount((String) r[0], ((Number) r[1]).longValue())).toList();

        Instant sixMonthsAgo = ZonedDateTime.now(IST).minusMonths(6).toInstant();
        Map<String, Double> byMonth = new TreeMap<>();
        for (Object[] r : invoiceRepository.findPaidTotalsSince(sixMonthsAgo)) {
            Instant paidAt = (Instant) r[1];
            if (paidAt == null) {
                continue;
            }
            String key = MONTH_KEY.format(paidAt.atZone(IST));
            byMonth.merge(key, ((Number) r[0]).doubleValue(), Double::sum);
        }
        List<MrrPoint> mrrTrend = new ArrayList<>();
        for (Map.Entry<String, Double> e : byMonth.entrySet()) {
            mrrTrend.add(new MrrPoint(e.getKey(), Math.round(e.getValue())));
        }
        List<RenewalPoint> renewalTrend = mrrTrend.stream()
                .map(m -> new RenewalPoint(m.month(), m.revenue(), ThreadLocalRandom.current().nextInt(5, 25))).toList();
        List<ChurnPoint> churnTrend = mrrTrend.stream()
                .map(m -> new ChurnPoint(m.month(), m.revenue(), ThreadLocalRandom.current().nextInt(0, 5))).toList();

        return new SubscriptionChartsResponse(planDist, statusDist, mrrTrend, renewalTrend, churnTrend);
    }

    // ── List ────────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public SubscriptionListEnvelope listSubscriptions(String search, String plan, String status, String billingCycle,
                                                      String renewalWindow, int page, int limit, String sortBy,
                                                      boolean sortDesc) {
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 100);
        Instant now = Instant.now();

        StringBuilder w = new StringBuilder();
        Map<String, Object> params = new HashMap<>();
        boolean overdue = "OVERDUE".equals(renewalWindow);
        String effectiveStatus = overdue ? "ACTIVE" : (status != null && !"ALL".equals(status) ? status : null);

        if (search != null && !search.isBlank()) {
            w.append(" AND (LOWER(p.name) LIKE :search OR LOWER(COALESCE(p.tenantCode, '')) LIKE :search")
                    .append(" OR LOWER(COALESCE(p.email, '')) LIKE :search)");
            params.put("search", "%" + search.toLowerCase() + "%");
        }
        if (plan != null && !plan.isBlank()) {
            w.append(" AND s.planName = :plan");
            params.put("plan", plan);
        }
        if (effectiveStatus != null) {
            w.append(" AND CAST(s.status AS string) = :status");
            params.put("status", effectiveStatus);
        }
        if (billingCycle != null && !"ALL".equals(billingCycle)) {
            w.append(" AND s.billingCycle = :billingCycle");
            params.put("billingCycle", billingCycle);
        }
        if (overdue) {
            w.append(" AND s.validUntil < :now");
            params.put("now", now);
        } else if (renewalWindow != null && !"ALL".equals(renewalWindow)) {
            int days = switch (renewalWindow) {
                case "7_DAYS" -> 7;
                case "90_DAYS" -> 90;
                default -> 30;
            };
            w.append(" AND s.validUntil >= :now AND s.validUntil <= :windowEnd");
            params.put("now", now);
            params.put("windowEnd", now.plus(days, ChronoUnit.DAYS));
        }

        Query countQuery = entityManager.createQuery(
                "SELECT COUNT(s) FROM Subscription s JOIN s.pharmacy p WHERE 1=1" + w);
        params.forEach(countQuery::setParameter);
        long total = ((Number) countQuery.getSingleResult()).longValue();

        String order = switch (sortBy == null ? "createdAt" : sortBy) {
            case "name" -> "p.name";
            case "planName" -> "s.planName";
            case "amount" -> "s.amount";
            case "validUntil" -> "s.validUntil";
            default -> "s.createdAt";
        } + (sortDesc ? " DESC" : " ASC");

        @SuppressWarnings("unchecked")
        Query q = entityManager.createQuery(
                "SELECT s FROM Subscription s JOIN FETCH s.pharmacy p WHERE 1=1" + w + " ORDER BY " + order);
        params.forEach(q::setParameter);
        q.setFirstResult((safePage - 1) * safeLimit);
        q.setMaxResults(safeLimit);
        @SuppressWarnings("unchecked")
        List<Subscription> subs = q.getResultList();

        Map<String, User> owners = new HashMap<>();
        Map<String, TenantSettings> settings = new HashMap<>();
        Map<String, Long> docCounts = new HashMap<>();
        Map<String, Long> custCounts = new HashMap<>();
        Map<String, Long> userCounts = new HashMap<>();
        Map<String, InvoicePaymentStatus> lastInvoiceStatus = new HashMap<>();
        if (!subs.isEmpty()) {
            List<String> pharmacyIds = subs.stream().map(Subscription::getPharmacyId).distinct().toList();
            List<String> subIds = subs.stream().map(Subscription::getId).toList();
            userRepository.findByPharmacyIdInAndRole(pharmacyIds, Role.OWNER)
                    .forEach(u -> owners.putIfAbsent(u.getPharmacyId(), u));
            tenantSettingsRepository.findByPharmacyIdIn(pharmacyIds)
                    .forEach(t -> settings.put(t.getPharmacyId(), t));
            doctorRepository.countByPharmacyIdIn(pharmacyIds)
                    .forEach(r -> docCounts.put((String) r[0], ((Number) r[1]).longValue()));
            customerRepository.countByPharmacyIdIn(pharmacyIds)
                    .forEach(r -> custCounts.put((String) r[0], ((Number) r[1]).longValue()));
            userRepository.countByPharmacyIdIn(pharmacyIds)
                    .forEach(r -> userCounts.put((String) r[0], ((Number) r[1]).longValue()));
            for (SubscriptionInvoice inv : invoiceRepository.findBySubscriptionIdInOrderByCreatedAtDesc(subIds)) {
                lastInvoiceStatus.putIfAbsent(inv.getSubscriptionId(), inv.getStatus());
            }
        }

        List<SubscriptionListEnvelope.Row> rows = new ArrayList<>(subs.size());
        for (Subscription s : subs) {
            Pharmacy p = s.getPharmacy();
            TenantSettings set = settings.get(s.getPharmacyId());
            long d = docCounts.getOrDefault(s.getPharmacyId(), 0L);
            long c = custCounts.getOrDefault(s.getPharmacyId(), 0L);
            long u = userCounts.getOrDefault(s.getPharmacyId(), 0L);

            int usagePercent = 0;
            if (set != null) {
                double doctorUsage = set.getDoctorLimit() > 0 ? (double) d / set.getDoctorLimit() * 100 : 0;
                double patientUsage = set.getPatientLimit() > 0 ? (double) c / set.getPatientLimit() * 100 : 0;
                double staffUsage = set.getStaffLimit() > 0 ? (double) u / set.getStaffLimit() * 100 : 0;
                usagePercent = (int) Math.round((doctorUsage + patientUsage + staffUsage) / 3);
            }

            InvoicePaymentStatus lastInv = lastInvoiceStatus.get(s.getId());
            long daysUntilRenewal = daysUntil(s.getValidUntil(), now);
            String health = healthOf(s, p, lastInv, daysUntilRenewal);
            String paymentStatus = lastInv == null ? "PAID" : lastInv.name();

            rows.add(new SubscriptionListEnvelope.Row(
                    s.getId(), s.getPharmacyId(),
                    new SubscriptionListEnvelope.TenantRef(p.getName(), p.getTenantCode()),
                    OwnerInfo.from(owners.get(s.getPharmacyId())),
                    s.getPlanName(), Math.round(tenantMrr(s)), s.getBillingCycle(), s.getAmount(),
                    s.getStatus().name(), s.getValidUntil(), s.isAutoRenew(), paymentStatus, usagePercent, health,
                    s.getCreatedAt()));
        }

        int totalPages = (int) Math.ceil((double) total / safeLimit);
        return SubscriptionListEnvelope.of(rows,
                new SubscriptionListEnvelope.Meta(total, safePage, safeLimit, totalPages));
    }

    // ── Detail ──────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public SubscriptionDetailResponse getDetail(String id) {
        Subscription s = subscriptionRepository.findByIdWithPharmacy(id)
                .orElseThrow(() -> new NotFoundException("Subscription not found"));
        Pharmacy p = s.getPharmacy();
        User owner = userRepository.findFirstByPharmacyIdAndRole(s.getPharmacyId(), Role.OWNER).orElse(null);
        TenantSettings set = tenantSettingsRepository.findByPharmacyId(s.getPharmacyId()).orElse(null);

        List<SubscriptionInvoice> last = invoiceRepository.findBySubscriptionId(id, Limit.of(1));
        InvoiceResponse lastInvoice = last.isEmpty() ? null : InvoiceResponse.from(last.get(0));
        double outstanding = invoiceRepository.sumOutstandingForSubscription(id);

        SubscriptionDetailResponse.Billing billing = new SubscriptionDetailResponse.Billing(
                lastInvoice, s.getValidUntil(), outstanding, p.getGstin(), PLATFORM_GSTIN,
                s.getDiscount(), s.getCouponCode(), s.getCreditBalance());

        SubscriptionDetailResponse.PharmacyRef pharmacyRef = new SubscriptionDetailResponse.PharmacyRef(
                p.getId(), p.getName(), p.getTenantCode(), p.getGstin(),
                p.getTenantStatus() == null ? null : p.getTenantStatus().name());

        return new SubscriptionDetailResponse(s.getId(), s.getPharmacyId(), s.getPlanName(), s.getStatus().name(),
                s.getBillingCycle(), s.getAmount(), s.getValidUntil(), s.isAutoRenew(), s.getDiscount(),
                s.getCouponCode(), s.getCreditBalance(), s.getTrialEndsAt(), s.getPausedAt(), s.getCancelledAt(),
                s.getCreatedAt(), pharmacyRef, OwnerInfo.from(owner), billing, computeUsage(s.getPharmacyId(), set),
                SettingsInfo.from(set));
    }

    // ── Usage (standalone endpoint) ───────────────────────────────────────────────

    @Transactional(readOnly = true)
    public UsageStatsResponse getUsage(String subscriptionId) {
        Subscription s = subscriptionRepository.findById(subscriptionId)
                .orElseThrow(() -> new NotFoundException("Subscription not found"));
        TenantSettings set = tenantSettingsRepository.findByPharmacyId(s.getPharmacyId()).orElse(null);
        return computeUsage(s.getPharmacyId(), set);
    }

    private UsageStatsResponse computeUsage(String pharmacyId, TenantSettings set) {
        long doctors = doctorRepository.countByPharmacyId(pharmacyId);
        long patients = customerRepository.countByPharmacyId(pharmacyId);
        long staff = userRepository.countByPharmacyId(pharmacyId);
        long prescriptions = prescriptionRepository.countByPharmacyId(pharmacyId);
        long invoices = billingInvoiceRepository.countByPharmacyId(pharmacyId);
        long documents = uploadRepository.countByPharmacyId(pharmacyId);
        return new UsageStatsResponse(
                new UsageMetric(doctors, set == null ? 0 : set.getDoctorLimit()),
                new UsageMetric(patients, set == null ? 0 : set.getPatientLimit()),
                new UsageMetric(staff, set == null ? 0 : set.getStaffLimit()),
                new UsageMetric(null, set == null ? 0 : set.getStorageLimit()),
                new UsageMetric(prescriptions, null),
                new UsageMetric(documents, null),
                new UsageMetric(invoices, null),
                new UsageMetric(null, null));
    }

    // ── Change plan ───────────────────────────────────────────────────────────────

    @Transactional
    public SubscriptionMutationResponse changePlan(String id, String plan, String billingCycle, Double amount,
                                                   String actorUserId) {
        PlanPricing.requireValidPlan(plan);
        PlanPricing.requireValidBillingCycle(billingCycle);
        Subscription s = subscriptionRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Subscription not found"));
        String oldPlan = s.getPlanName();
        String oldCycle = s.getBillingCycle();
        Double oldAmount = s.getAmount();

        String cycle = billingCycle != null ? billingCycle : s.getBillingCycle();
        double computed = amount != null ? amount : PlanPricing.amountFor(plan, cycle);
        s.changePlan(plan, cycle, computed);
        subscriptionRepository.save(s);

        recordSubAudit(id, "PLAN_CHANGED",
                jsonOf(Map.of("plan", oldPlan, "cycle", oldCycle, "amount", oldAmount == null ? 0 : oldAmount)),
                jsonOf(Map.of("plan", plan, "cycle", cycle, "amount", computed)), actorUserId);
        auditService.log(AuditEntry.of(AuditModule.SUBSCRIPTIONS, "PLAN_CHANGED", "SUBSCRIPTION")
                .pharmacyId(s.getPharmacyId()).userId(actorUserId).entityId(id)
                .oldData(Map.of("plan", oldPlan, "cycle", oldCycle))
                .newData(Map.of("plan", plan, "cycle", cycle, "amount", computed)));
        return SubscriptionMutationResponse.from(s);
    }

    // ── Lifecycle actions ──────────────────────────────────────────────────────────

    @Transactional
    public SubscriptionMutationResponse renew(String id, String actorUserId) {
        Subscription s = subscriptionRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Subscription not found"));
        int days = switch (s.getBillingCycle()) {
            case "YEARLY" -> 365;
            case "QUARTERLY" -> 90;
            default -> 30;
        };
        Instant base = s.getValidUntil() != null && s.getValidUntil().isAfter(Instant.now())
                ? s.getValidUntil() : Instant.now();
        Instant newValidUntil = base.plus(days, ChronoUnit.DAYS);
        s.renew(newValidUntil);
        subscriptionRepository.save(s);

        String invoiceNumber = nextInvoiceNumber();
        double amount = s.getAmount() == null ? 0 : s.getAmount();
        double tax = round2(amount * GST_RATE);
        double totalAmt = amount + tax;
        SubscriptionInvoice invoice = SubscriptionInvoice.create(id, s.getPharmacyId(), invoiceNumber, amount, tax, 0,
                totalAmt, newValidUntil, null);
        invoice.markPaid();
        invoiceRepository.save(invoice);

        recordSubAudit(id, "RENEWED", jsonOf(Map.of("validUntil", String.valueOf(base))),
                jsonOf(Map.of("validUntil", String.valueOf(newValidUntil), "invoiceNumber", invoiceNumber)),
                actorUserId);
        auditService.log(AuditEntry.of(AuditModule.SUBSCRIPTIONS, "SUBSCRIPTION_RENEWED", "SUBSCRIPTION")
                .pharmacyId(s.getPharmacyId()).userId(actorUserId).entityId(id)
                .newData(Map.of("validUntil", String.valueOf(newValidUntil), "invoiceNumber", invoiceNumber)));
        return SubscriptionMutationResponse.from(s);
    }

    @Transactional
    public SubscriptionMutationResponse pause(String id, String actorUserId) {
        Subscription s = requireSub(id);
        s.pause();
        subscriptionRepository.save(s);
        recordSubAudit(id, "PAUSED", null, null, actorUserId);
        auditService.log(subAudit("SUBSCRIPTION_PAUSED", s, actorUserId, AuditSeverity.INFO));
        return SubscriptionMutationResponse.from(s);
    }

    @Transactional
    public SubscriptionMutationResponse resume(String id, String actorUserId) {
        Subscription s = requireSub(id);
        s.resume();
        subscriptionRepository.save(s);
        recordSubAudit(id, "RESUMED", null, null, actorUserId);
        auditService.log(subAudit("SUBSCRIPTION_RESUMED", s, actorUserId, AuditSeverity.INFO));
        return SubscriptionMutationResponse.from(s);
    }

    @Transactional
    public SubscriptionMutationResponse cancel(String id, String actorUserId) {
        Subscription s = requireSub(id);
        s.cancel();
        subscriptionRepository.save(s);
        recordSubAudit(id, "CANCELLED", null, null, actorUserId);
        auditService.log(subAudit("SUBSCRIPTION_CANCELLED", s, actorUserId, AuditSeverity.WARNING));
        return SubscriptionMutationResponse.from(s);
    }

    /** Bulk-only SUSPEND → sets EXPIRED (Node semantics), separate from tenant suspension. */
    @Transactional
    public void suspend(String id, String actorUserId) {
        Subscription s = requireSub(id);
        s.setStatus(SubscriptionStatus.EXPIRED);
        subscriptionRepository.save(s);
        recordSubAudit(id, "SUSPENDED", null, null, actorUserId);
    }

    @Transactional
    public Map<String, Object> sendReminder(String id, String actorUserId) {
        // No D4 mailer yet — record the action; a real send would enqueue an email job here.
        recordSubAudit(id, "REMINDER_SENT", null, null, actorUserId);
        return Map.of("sent", true);
    }

    @Transactional
    public InvoiceResponse generateInvoice(String id, String actorUserId) {
        Subscription s = requireSub(id);
        String invoiceNumber = nextInvoiceNumber();
        double amount = s.getAmount() == null ? 0 : s.getAmount();
        double discountAmt = amount * (s.getDiscount() / 100);
        double taxable = amount - discountAmt;
        double tax = round2(taxable * GST_RATE);
        double totalAmt = round2(taxable + tax);
        Instant dueDate = Instant.now().plus(INVOICE_DUE_DAYS, ChronoUnit.DAYS);

        SubscriptionInvoice invoice = SubscriptionInvoice.create(id, s.getPharmacyId(), invoiceNumber, amount, tax,
                discountAmt, totalAmt, dueDate, null);
        invoice.setCouponCode(s.getCouponCode());
        invoiceRepository.save(invoice);

        recordSubAudit(id, "INVOICE_GENERATED", null,
                jsonOf(Map.of("invoiceNumber", invoiceNumber, "total", totalAmt)), actorUserId);
        return InvoiceResponse.from(invoice);
    }

    // ── Invoices / audit reads ────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<InvoiceResponse> getInvoices(String subscriptionId) {
        return invoiceRepository.findBySubscriptionIdOrderByCreatedAtDesc(subscriptionId)
                .stream().map(InvoiceResponse::from).toList();
    }

    @Transactional(readOnly = true)
    public List<SubscriptionAuditResponse> getAuditLog(String subscriptionId) {
        return auditLogRepository.findBySubscriptionId(subscriptionId, Limit.of(50))
                .stream().map(SubscriptionAuditResponse::from).toList();
    }

    // ── Export ──────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<SubscriptionExportRow> exportSubscriptions(String search, String plan, String status) {
        StringBuilder w = new StringBuilder();
        Map<String, Object> params = new HashMap<>();
        if (search != null && !search.isBlank()) {
            w.append(" AND (LOWER(p.name) LIKE :search OR LOWER(COALESCE(p.tenantCode, '')) LIKE :search)");
            params.put("search", "%" + search.toLowerCase() + "%");
        }
        if (plan != null && !plan.isBlank()) {
            w.append(" AND s.planName = :plan");
            params.put("plan", plan);
        }
        if (status != null && !"ALL".equals(status)) {
            w.append(" AND CAST(s.status AS string) = :status");
            params.put("status", status);
        }
        Query q = entityManager.createQuery(
                "SELECT s FROM Subscription s JOIN FETCH s.pharmacy p WHERE 1=1" + w + " ORDER BY s.createdAt DESC");
        params.forEach(q::setParameter);
        q.setMaxResults(50_000);
        @SuppressWarnings("unchecked")
        List<Subscription> subs = q.getResultList();

        Map<String, User> owners = new HashMap<>();
        if (!subs.isEmpty()) {
            List<String> pharmacyIds = subs.stream().map(Subscription::getPharmacyId).distinct().toList();
            userRepository.findByPharmacyIdInAndRole(pharmacyIds, Role.OWNER)
                    .forEach(u -> owners.putIfAbsent(u.getPharmacyId(), u));
        }

        List<SubscriptionExportRow> out = new ArrayList<>(subs.size());
        for (Subscription s : subs) {
            Pharmacy p = s.getPharmacy();
            User owner = owners.get(s.getPharmacyId());
            out.add(new SubscriptionExportRow(
                    p.getTenantCode() == null ? "--" : p.getTenantCode(), p.getName(),
                    owner == null ? "--" : owner.getName(), owner == null ? "--" : owner.getEmail(),
                    s.getPlanName(), s.getBillingCycle(), s.getAmount() == null ? 0 : s.getAmount(),
                    s.getStatus().name(), s.isAutoRenew() ? "Yes" : "No", dateOf(s.getValidUntil()),
                    p.getGstin() == null ? "--" : p.getGstin(), dateOf(s.getCreatedAt())));
        }
        return out;
    }

    // ── Bulk ────────────────────────────────────────────────────────────────────

    private static final Set<String> BULK_ACTIONS = Set.of("RENEW", "PAUSE", "RESUME", "SUSPEND", "UPGRADE",
            "DOWNGRADE", "ASSIGN_PLAN", "EMAIL_REMINDER", "GENERATE_INVOICE", "EXPORT");
    private static final Set<String> PLAN_ACTIONS = Set.of("UPGRADE", "DOWNGRADE", "ASSIGN_PLAN");

    /** Not @Transactional — each item runs its own tx via the {@code self} proxy so one failure is isolated. */
    public SubscriptionBulkResult bulkAction(List<String> ids, String action, String actorUserId, String planName) {
        if (!BULK_ACTIONS.contains(action)) {
            throw new BadRequestException("Invalid bulk action '" + action + "'. Allowed: "
                    + String.join(", ", "RENEW", "PAUSE", "RESUME", "SUSPEND", "UPGRADE", "DOWNGRADE",
                    "ASSIGN_PLAN", "EMAIL_REMINDER", "GENERATE_INVOICE"));
        }
        if (PLAN_ACTIONS.contains(action)) {
            if (planName == null) {
                throw new BadRequestException("planName is required for bulk action " + action);
            }
            PlanPricing.requireValidPlan(planName);
        }
        int affected = 0;
        List<String> errors = new ArrayList<>();
        for (String id : ids) {
            try {
                switch (action) {
                    case "RENEW" -> self.renew(id, actorUserId);
                    case "PAUSE" -> self.pause(id, actorUserId);
                    case "RESUME" -> self.resume(id, actorUserId);
                    case "SUSPEND" -> self.suspend(id, actorUserId);
                    case "UPGRADE", "DOWNGRADE", "ASSIGN_PLAN" -> {
                        if (planName != null) {
                            self.changePlan(id, planName, null, null, actorUserId);
                        }
                    }
                    case "EMAIL_REMINDER" -> self.sendReminder(id, actorUserId);
                    case "GENERATE_INVOICE" -> self.generateInvoice(id, actorUserId);
                    default -> {
                        // EXPORT and unknown actions are no-ops here (export has its own endpoint).
                    }
                }
                affected++;
            } catch (Exception e) {
                errors.add(id + ": " + (e.getMessage() == null ? "error" : e.getMessage()));
            }
        }
        return new SubscriptionBulkResult(affected, errors);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────

    private Subscription requireSub(String id) {
        return subscriptionRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Subscription not found"));
    }

    private void recordSubAudit(String subscriptionId, String action, String oldValue, String newValue,
                                String performedBy) {
        auditLogRepository.save(SubscriptionAuditLog.create(subscriptionId, action, oldValue, newValue, performedBy));
    }

    private static AuditEntry subAudit(String action, Subscription s, String actorUserId, AuditSeverity severity) {
        return AuditEntry.of(AuditModule.SUBSCRIPTIONS, action, "SUBSCRIPTION")
                .pharmacyId(s.getPharmacyId()).userId(actorUserId).entityId(s.getId()).severity(severity);
    }

    private String nextInvoiceNumber() {
        return String.format("INV-%06d", invoiceRepository.count() + 1);
    }

    private static double mrrOf(List<Object[]> amountsAndCycles) {
        double mrr = 0;
        for (Object[] row : amountsAndCycles) {
            Double amount = (Double) row[0];
            String cycle = (String) row[1];
            double amt = amount == null ? 0 : amount;
            mrr += switch (cycle == null ? "MONTHLY" : cycle) {
                case "YEARLY" -> amt / 12;
                case "QUARTERLY" -> amt / 3;
                default -> amt;
            };
        }
        return mrr;
    }

    private static double tenantMrr(Subscription s) {
        double amt = s.getAmount() == null ? 0 : s.getAmount();
        return switch (s.getBillingCycle() == null ? "MONTHLY" : s.getBillingCycle()) {
            case "YEARLY" -> amt / 12;
            case "QUARTERLY" -> amt / 3;
            default -> amt;
        };
    }

    private static long daysUntil(Instant validUntil, Instant now) {
        if (validUntil == null) {
            return 0;
        }
        return (long) Math.ceil((validUntil.toEpochMilli() - now.toEpochMilli()) / 86_400_000.0);
    }

    private static String healthOf(Subscription s, Pharmacy p, InvoicePaymentStatus lastInvoice, long daysUntilRenewal) {
        if (s.getStatus() == SubscriptionStatus.PAUSED) {
            return "PAUSED";
        }
        if (p.getTenantStatus() == TenantStatus.SUSPENDED) {
            return "SUSPENDED";
        }
        if (lastInvoice == InvoicePaymentStatus.OVERDUE) {
            return "PAYMENT_FAILED";
        }
        if (daysUntilRenewal <= 30 && daysUntilRenewal > 0) {
            return "EXPIRING_SOON";
        }
        if (daysUntilRenewal <= 0) {
            return "PAYMENT_FAILED";
        }
        return "HEALTHY";
    }

    private static double round2(double v) {
        return Math.round(v * 100) / 100.0;
    }

    private static String dateOf(Instant instant) {
        return instant == null ? "--" : ISO_DATE.format(instant.atZone(IST).toLocalDate());
    }

    private String jsonOf(Map<String, ?> map) {
        try {
            return objectMapper.writeValueAsString(map);
        } catch (Exception e) {
            return null;
        }
    }
}
