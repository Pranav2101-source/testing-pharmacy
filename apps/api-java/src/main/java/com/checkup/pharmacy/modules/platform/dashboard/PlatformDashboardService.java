package com.checkup.pharmacy.modules.platform.dashboard;

import com.checkup.pharmacy.common.enums.TicketPriority;
import com.checkup.pharmacy.common.enums.TicketStatus;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
import com.checkup.pharmacy.modules.doctor.DoctorRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.platform.dashboard.dto.PlatformStatsResponse;
import com.checkup.pharmacy.modules.platform.dashboard.dto.PlatformStatsResponse.ActivityItem;
import com.checkup.pharmacy.modules.platform.dashboard.dto.PlatformStatsResponse.Alert;
import com.checkup.pharmacy.modules.platform.dashboard.dto.PlatformStatsResponse.Financials;
import com.checkup.pharmacy.modules.platform.dashboard.dto.PlatformStatsResponse.HealthItem;
import com.checkup.pharmacy.modules.platform.dashboard.dto.PlatformStatsResponse.RealStats;
import com.checkup.pharmacy.modules.platform.dashboard.dto.PlatformStatsResponse.SystemHealth;
import com.checkup.pharmacy.modules.platform.domain.SubscriptionRepository;
import com.checkup.pharmacy.modules.prescription.PrescriptionRepository;
import com.checkup.pharmacy.modules.support.SupportTicket;
import com.checkup.pharmacy.modules.support.SupportTicketRepository;
import com.checkup.pharmacy.modules.user.UserRepository;
import jakarta.persistence.EntityManager;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Platform-wide dashboard aggregation (platform admin only). Reads across every
 * tenant, so — like {@code ReportsService} — it injects the repositories it needs
 * directly rather than going through each module's service. Ported from the
 * deleted Node {@code dashboard.service.ts}.
 *
 * Financials (MRR/ARR) are computed live from active subscriptions on each call.
 * The Node original cached them in Redis for 60s; that was a latency optimization,
 * not part of the wire contract, and the query (a single indexed status filter) is
 * cheap enough that the dashboard doesn't need it.
 */
@Service
public class PlatformDashboardService {

    private static final List<TicketStatus> OPEN_STATUSES =
            List.of(TicketStatus.OPEN, TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS, TicketStatus.PENDING_USER);
    private static final List<TicketStatus> URGENT_STATUSES =
            List.of(TicketStatus.OPEN, TicketStatus.ASSIGNED);

    private final PharmacyRepository pharmacyRepository;
    private final DoctorRepository doctorRepository;
    private final CustomerRepository customerRepository;
    private final UserRepository userRepository;
    private final SupportTicketRepository ticketRepository;
    private final PrescriptionRepository prescriptionRepository;
    private final SubscriptionRepository subscriptionRepository;
    private final RedisConnectionFactory redisConnectionFactory;
    private final EntityManager entityManager;

    public PlatformDashboardService(PharmacyRepository pharmacyRepository, DoctorRepository doctorRepository,
                                    CustomerRepository customerRepository, UserRepository userRepository,
                                    SupportTicketRepository ticketRepository,
                                    PrescriptionRepository prescriptionRepository,
                                    SubscriptionRepository subscriptionRepository,
                                    RedisConnectionFactory redisConnectionFactory, EntityManager entityManager) {
        this.pharmacyRepository = pharmacyRepository;
        this.doctorRepository = doctorRepository;
        this.customerRepository = customerRepository;
        this.userRepository = userRepository;
        this.ticketRepository = ticketRepository;
        this.prescriptionRepository = prescriptionRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.redisConnectionFactory = redisConnectionFactory;
        this.entityManager = entityManager;
    }

    @Transactional(readOnly = true)
    public PlatformStatsResponse getStats() {
        long totalPharmacies = pharmacyRepository.count();
        long activePharmacies = pharmacyRepository.countByIsActiveTrue();
        long totalDoctors = doctorRepository.count();
        long totalPatients = customerRepository.count();
        long totalUsers = userRepository.count();
        long totalTickets = ticketRepository.count();
        long openTickets = ticketRepository.countByStatusIn(OPEN_STATUSES);
        long urgentTickets = ticketRepository.countByStatusInAndPriority(URGENT_STATUSES, TicketPriority.URGENT);
        long totalConsultations = prescriptionRepository.count();

        List<ActivityItem> activityFeed = new ArrayList<>();
        for (Pharmacy p : pharmacyRepository.findTop3ByOrderByCreatedAtDesc()) {
            activityFeed.add(new ActivityItem(p.getId(), "PHARMACY_CREATED",
                    "New Pharmacy registered: " + p.getName(), p.getCreatedAt()));
        }
        for (SupportTicket t : ticketRepository.findTop3ByOrderByCreatedAtDesc()) {
            activityFeed.add(new ActivityItem(t.getId(), "TICKET_CREATED",
                    "New Support Ticket raised: " + t.getTicketNumber(), t.getCreatedAt()));
        }
        activityFeed.sort(Comparator.comparing(ActivityItem::timestamp).reversed());

        RealStats real = new RealStats(totalPharmacies, activePharmacies, totalDoctors, totalPatients, totalUsers,
                totalTickets, openTickets, urgentTickets, totalConsultations, activityFeed);

        Financials metrics = computeFinancials();
        SystemHealth systemHealth = probeSystemHealth();

        List<Alert> criticalAlerts = new ArrayList<>();
        if (urgentTickets > 0) {
            criticalAlerts.add(new Alert("alert-2", "DANGER", "⚠ " + urgentTickets + " open urgent tickets"));
        }

        return new PlatformStatsResponse(real, metrics, systemHealth, criticalAlerts);
    }

    private Financials computeFinancials() {
        double mrr = 0;
        for (Object[] row : subscriptionRepository.findActiveAmountsAndCycles()) {
            Double amount = (Double) row[0];
            String cycle = (String) row[1];
            double amt = amount == null ? 0 : amount;
            if ("MONTHLY".equals(cycle)) {
                mrr += amt;
            } else if ("QUARTERLY".equals(cycle)) {
                mrr += amt / 3.0;
            } else if ("YEARLY".equals(cycle)) {
                mrr += amt / 12.0;
            }
        }
        long roundedMrr = Math.round(mrr);
        long arr = Math.round(mrr * 12);
        // Payments/renewals/failed-payment tracking isn't modelled yet — 0, matching the Node original.
        return new Financials(roundedMrr, arr, 0, 0, 0, 0);
    }

    private SystemHealth probeSystemHealth() {
        HealthItem database;
        try {
            long start = System.currentTimeMillis();
            entityManager.createNativeQuery("SELECT 1").getSingleResult();
            long latency = System.currentTimeMillis() - start;
            database = new HealthItem("HEALTHY", latency + "ms", "PostgreSQL active");
        } catch (Exception e) {
            database = new HealthItem("WARNING", "Timeout", "Could not connect");
        }

        HealthItem redis;
        try {
            redisConnectionFactory.getConnection().ping();
            redis = new HealthItem("HEALTHY", "Connected", "Active");
        } catch (Exception e) {
            redis = new HealthItem("WARNING", "Disconnected", "No connection");
        }

        HealthItem storage;
        try {
            Object size = entityManager
                    .createNativeQuery("SELECT pg_database_size(current_database())")
                    .getSingleResult();
            double sizeMb = ((Number) size).doubleValue() / 1024.0 / 1024.0;
            storage = new HealthItem("HEALTHY", String.format("%.2f MB", sizeMb), "PostgreSQL DB Size");
        } catch (Exception e) {
            storage = new HealthItem("WARNING", "Unknown", "Unable to read size");
        }

        HealthItem queue = new HealthItem("OFFLINE", "--", "Not tracked");
        HealthItem api = new HealthItem("HEALTHY", "Online", "Serving requests");
        return new SystemHealth(database, redis, queue, storage, api);
    }

    @Transactional(readOnly = true)
    public String exportReportCsv() {
        PlatformStatsResponse stats = getStats();
        long activeSubscriptions = subscriptionRepository.countByStatus(com.checkup.pharmacy.common.enums.SubscriptionStatus.ACTIVE);

        StringBuilder sb = new StringBuilder();
        sb.append("Metric,Value\n");
        sb.append("Monthly Recurring Revenue (MRR),").append(stats.metrics().mrr()).append('\n');
        sb.append("Annual Recurring Revenue (ARR),").append(stats.metrics().arr()).append('\n');
        sb.append("Today's Revenue,").append(stats.metrics().todaysRevenue()).append('\n');
        sb.append("Active Subscriptions,").append(activeSubscriptions).append('\n');
        sb.append("Active Pharmacies,").append(stats.real().activePharmacies()).append('\n');
        sb.append("Active Doctors,").append(stats.real().totalDoctors()).append('\n');
        sb.append("Active Patients,").append(stats.real().totalPatients()).append('\n');
        sb.append("Storage Usage,").append(stats.systemHealth().storage().value()).append('\n');
        sb.append("Support Tickets,").append(stats.real().openTickets()).append(" Open / ")
                .append(stats.real().urgentTickets()).append(" Urgent").append('\n');
        return sb.toString();
    }
}
