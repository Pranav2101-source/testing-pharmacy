package com.checkup.pharmacy.modules.platform.tenant;

import com.checkup.pharmacy.common.enums.AuditModule;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.enums.SubscriptionStatus;
import com.checkup.pharmacy.common.enums.TenantStatus;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.audit.AuditEntry;
import com.checkup.pharmacy.modules.audit.AuditLog;
import com.checkup.pharmacy.modules.audit.AuditLogRepository;
import com.checkup.pharmacy.modules.audit.AuditService;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
import com.checkup.pharmacy.modules.doctor.DoctorRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.platform.domain.Subscription;
import com.checkup.pharmacy.modules.platform.domain.SubscriptionRepository;
import com.checkup.pharmacy.modules.platform.domain.TenantSettings;
import com.checkup.pharmacy.modules.platform.domain.TenantSettingsRepository;
import com.checkup.pharmacy.modules.platform.tenant.dto.BulkActionResult;
import com.checkup.pharmacy.modules.platform.tenant.dto.CreateTenantRequest;
import com.checkup.pharmacy.modules.platform.tenant.dto.CreateTenantResponse;
import com.checkup.pharmacy.modules.platform.tenant.dto.ImportResult;
import com.checkup.pharmacy.modules.platform.tenant.dto.ImportTenantsRequest;
import com.checkup.pharmacy.modules.platform.tenant.dto.OwnerInfo;
import com.checkup.pharmacy.modules.platform.tenant.dto.SettingsInfo;
import com.checkup.pharmacy.modules.platform.tenant.dto.SubscriptionInfo;
import com.checkup.pharmacy.modules.platform.tenant.dto.TenantActivityItem;
import com.checkup.pharmacy.modules.platform.tenant.dto.TenantDetailResponse;
import com.checkup.pharmacy.modules.platform.tenant.dto.TenantListEnvelope;
import com.checkup.pharmacy.modules.support.SupportTicketRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.springframework.data.domain.Limit;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Platform tenant management (list/detail/create/status/bulk/import/export/activity).
 * Ported from the deleted Node {@code tenants.service.ts}. Actual tenant creation
 * is delegated to the shared {@link PharmacyOnboardingService}. Cross-tenant by
 * design — this is the platform-admin surface, so queries are NOT scoped to a
 * single {@code TenantContext.pharmacyId()}.
 */
@Service
public class TenantService {

    private static final String PW_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
    private static final int PW_LEN = 16;
    private static final int EXPORT_CAP = 50_000;
    private static final int ACTIVITY_LIMIT = 20;
    private static final SecureRandom RNG = new SecureRandom();
    private static final DateTimeFormatter DATE = DateTimeFormatter.ISO_LOCAL_DATE.withZone(ZoneOffset.UTC);

    private final PharmacyRepository pharmacyRepository;
    private final UserRepository userRepository;
    private final SubscriptionRepository subscriptionRepository;
    private final TenantSettingsRepository tenantSettingsRepository;
    private final DoctorRepository doctorRepository;
    private final CustomerRepository customerRepository;
    private final SupportTicketRepository ticketRepository;
    private final AuditLogRepository auditLogRepository;
    private final AuditService auditService;
    private final PasswordEncoder passwordEncoder;
    private final PharmacyOnboardingService onboardingService;
    private final EntityManager entityManager;

    public TenantService(PharmacyRepository pharmacyRepository, UserRepository userRepository,
                         SubscriptionRepository subscriptionRepository,
                         TenantSettingsRepository tenantSettingsRepository, DoctorRepository doctorRepository,
                         CustomerRepository customerRepository, SupportTicketRepository ticketRepository,
                         AuditLogRepository auditLogRepository, AuditService auditService,
                         PasswordEncoder passwordEncoder, PharmacyOnboardingService onboardingService,
                         EntityManager entityManager) {
        this.pharmacyRepository = pharmacyRepository;
        this.userRepository = userRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.tenantSettingsRepository = tenantSettingsRepository;
        this.doctorRepository = doctorRepository;
        this.customerRepository = customerRepository;
        this.ticketRepository = ticketRepository;
        this.auditLogRepository = auditLogRepository;
        this.auditService = auditService;
        this.passwordEncoder = passwordEncoder;
        this.onboardingService = onboardingService;
        this.entityManager = entityManager;
    }

    // ── List ──────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public TenantListEnvelope listTenants(String search, String status, String plan, String state, String city,
                                          int page, int limit, String sortBy, boolean sortDesc) {
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 100);

        Filters f = buildFilters(search, status, plan, state, city, null);
        long total = countRows(f);

        String order = sortColumn(sortBy) + (sortDesc ? " DESC" : " ASC");
        List<Object[]> rows = queryRows(f, order, (safePage - 1) * safeLimit, safeLimit);

        Map<String, User> owners = ownersByPharmacy(rows);
        List<TenantListEnvelope.Item> items = new ArrayList<>(rows.size());
        for (Object[] r : rows) {
            String id = (String) r[0];
            User owner = owners.get(id);
            items.add(new TenantListEnvelope.Item(
                    id, (String) r[1], (String) r[2], (String) r[3], null,
                    (String) r[4], (String) r[5], (Boolean) r[6], (TenantStatus) r[7], toInstant(r[8]),
                    ((Number) r[12]).longValue(), ((Number) r[13]).longValue(),
                    OwnerInfo.from(owner), subscriptionFromRow(r)));
        }

        int totalPages = (int) Math.ceil((double) total / safeLimit);
        return TenantListEnvelope.of(items, new TenantListEnvelope.Meta(total, safePage, safeLimit, totalPages));
    }

    // ── Detail ────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public TenantDetailResponse getTenant(String id) {
        Pharmacy p = pharmacyRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Tenant not found"));
        User owner = userRepository.findFirstByPharmacyIdAndRole(id, Role.OWNER).orElse(null);
        Subscription sub = subscriptionRepository.findByPharmacyId(id).orElse(null);
        TenantSettings settings = tenantSettingsRepository.findByPharmacyId(id).orElse(null);
        long doctors = doctorRepository.countByPharmacyId(id);
        long patients = customerRepository.countByPharmacyId(id);
        long tickets = ticketRepository.countByPharmacyId(id);

        return new TenantDetailResponse(p.getId(), p.getTenantCode(), p.getName(), p.getSlug(), p.getGstin(),
                p.getDrugLicense(), p.getPhone(), p.getEmail(), p.getAddress(), p.getCity(), p.getState(),
                p.getPincode(), p.isActive(), p.getTenantStatus(), p.getCreatedAt(), OwnerInfo.from(owner),
                SubscriptionInfo.from(sub), SettingsInfo.from(settings), doctors, patients, tickets);
    }

    // ── Create ────────────────────────────────────────────────────────────────

    /** Not @Transactional itself — {@link PharmacyOnboardingService#onboard} owns the tx boundary. */
    public CreateTenantResponse createTenant(CreateTenantRequest req, String actorUserId, String actorEmail) {
        if (req.planName() != null) {
            PlanPricing.requireValidPlan(req.planName());
        }
        String temporaryPassword = generatePassword();
        String hash = passwordEncoder.encode(temporaryPassword);

        OnboardCommand cmd = toCommand(req, hash);
        PharmacyOnboardingService.OnboardResult r = onboardingService.onboard(cmd, actorUserId, actorEmail);

        CreateTenantResponse.TenantSummary summary = new CreateTenantResponse.TenantSummary(
                r.pharmacy().getId(), r.pharmacy().getTenantCode(), r.pharmacy().getName(),
                OwnerInfo.from(r.owner()), SubscriptionInfo.from(r.subscription()), SettingsInfo.from(r.settings()));
        return new CreateTenantResponse(summary, temporaryPassword);
    }

    // ── Update status ───────────────────────────────────────────────────────────

    private static final Set<String> ALLOWED_STATUSES =
            Set.of("ACTIVE", "SUSPENDED", "ARCHIVED", "TRIAL", "EXPIRED");

    @Transactional
    public TenantDetailResponse updateTenantStatus(String id, String status, String actorUserId) {
        if (!ALLOWED_STATUSES.contains(status)) {
            throw new BadRequestException("Invalid status '" + status
                    + "'. Allowed: ACTIVE, SUSPENDED, ARCHIVED, TRIAL, EXPIRED");
        }
        Pharmacy p = pharmacyRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Tenant not found"));

        TenantStatus previous = p.getTenantStatus();
        boolean isActive = "ACTIVE".equals(status) || "TRIAL".equals(status);
        p.applyStatus(TenantStatus.valueOf(status), isActive);
        pharmacyRepository.save(p);

        if (revokesSessions(status)) {
            userRepository.bumpTokenVersionByPharmacyId(id);
        }

        auditService.log(AuditEntry.of(AuditModule.TENANTS, "STATUS_CHANGED_TO_" + status, "PHARMACY")
                .pharmacyId(id).userId(actorUserId).entityId(id)
                .oldData(Map.of("status", previous == null ? "" : previous.name()))
                .newData(Map.of("status", status)));

        return getTenant(id);
    }

    // ── Bulk action ─────────────────────────────────────────────────────────────

    @Transactional
    public BulkActionResult bulkAction(List<String> ids, String action, String actorUserId) {
        TenantStatus target = switch (action) {
            case "SUSPEND" -> TenantStatus.SUSPENDED;
            case "ACTIVATE" -> TenantStatus.ACTIVE;
            case "ARCHIVE" -> TenantStatus.ARCHIVED;
            default -> throw new BadRequestException("Invalid bulk action '" + action
                    + "'. Allowed: SUSPEND, ACTIVATE, ARCHIVE");
        };
        boolean isActive = target == TenantStatus.ACTIVE;

        List<Pharmacy> pharmacies = pharmacyRepository.findAllById(ids);
        for (Pharmacy p : pharmacies) {
            p.applyStatus(target, isActive);
        }
        pharmacyRepository.saveAll(pharmacies);

        if (target != TenantStatus.ACTIVE && !ids.isEmpty()) {
            userRepository.bumpTokenVersionByPharmacyIds(ids);
        }

        for (String pharmacyId : ids) {
            auditService.log(AuditEntry.of(AuditModule.TENANTS, "BULK_" + action, "PHARMACY")
                    .pharmacyId(pharmacyId).userId(actorUserId).entityId(pharmacyId));
        }
        return new BulkActionResult(pharmacies.size());
    }

    // ── Import ──────────────────────────────────────────────────────────────────

    /** Not @Transactional — each row's onboarding is its own tx, so one row's 409 can't roll back the rest. */
    public ImportResult importTenants(List<ImportTenantsRequest.Row> rows, String actorUserId,
                                      String actorPharmacyId) {
        int imported = 0;
        int skipped = 0;
        int failed = 0;
        List<ImportResult.ImportError> errors = new ArrayList<>();

        for (int i = 0; i < rows.size(); i++) {
            ImportTenantsRequest.Row row = rows.get(i);
            String rowError = validateImportRow(row);
            if (rowError != null) {
                failed++;
                errors.add(new ImportResult.ImportError(i + 1, safe(row.ownerEmail()), rowError));
                continue;
            }
            try {
                CreateTenantRequest req = new CreateTenantRequest(row.name(), row.gstin(), row.drugLicense(),
                        row.address(), row.city(), row.state(), row.pincode(), row.phone(), row.email(),
                        row.ownerName(), row.ownerEmail(), row.ownerPhone(),
                        row.planName() == null ? PlanPricing.DEFAULT_PLAN : row.planName(),
                        null, null, null, null, null, null, null, null, null, null, null, null);
                createTenant(req, actorUserId, null);
                imported++;
            } catch (ConflictException e) {
                skipped++;
                errors.add(new ImportResult.ImportError(i + 1, safe(row.ownerEmail()), e.getMessage()));
            } catch (Exception e) {
                failed++;
                errors.add(new ImportResult.ImportError(i + 1, safe(row.ownerEmail()),
                        e.getMessage() == null ? "Unknown error" : e.getMessage()));
            }
        }

        if (actorPharmacyId != null) {
            auditService.log(AuditEntry.of(AuditModule.TENANTS, "IMPORTED_TENANTS", "PHARMACY")
                    .pharmacyId(actorPharmacyId).userId(actorUserId)
                    .newData(Map.of("imported", imported, "skipped", skipped, "failed", failed)));
        }
        return new ImportResult(imported, skipped, failed, errors);
    }

    // ── Activity ────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<TenantActivityItem> getTenantActivity(String id) {
        return auditLogRepository.findByPharmacyIdWithUser(id, Limit.of(ACTIVITY_LIMIT))
                .stream().map(TenantActivityItem::from).toList();
    }

    // ── Export ────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public String exportCsv(String search, String status, String plan, String state, String ids) {
        Filters f = buildFilters(search, status, plan, state, null, ids);
        List<Object[]> rows = queryRows(f, "p.id ASC", 0, EXPORT_CAP);
        Map<String, User> owners = ownersByPharmacy(rows);

        StringBuilder sb = new StringBuilder();
        sb.append("Tenant ID,Code,Pharmacy Name,Owner,Owner Email,Owner Phone,Plan,Status,Created Date,")
                .append("Renewal Date,Doctors,Patients,Storage,Last Login,Subscription Status\r\n");
        for (Object[] r : rows) {
            String id = (String) r[0];
            User owner = owners.get(id);
            String planName = (String) r[9];
            SubscriptionStatus subStatus = (SubscriptionStatus) r[10];
            String renewal = r[11] == null ? "--" : DATE.format(toInstant(r[11]));
            String created = r[8] == null ? "--" : DATE.format(toInstant(r[8]));
            String lastLogin = owner == null || owner.getLastLoginAt() == null ? "--" : owner.getLastLoginAt().toString();
            sb.append(csv(id)).append(',')
                    .append(csv(orDash((String) r[1]))).append(',')
                    .append(csv((String) r[2])).append(',')
                    .append(csv(owner == null ? "--" : owner.getName())).append(',')
                    .append(csv(owner == null ? "--" : owner.getEmail())).append(',')
                    .append(csv(owner == null || owner.getPhone() == null ? "--" : owner.getPhone())).append(',')
                    .append(csv(planName == null ? "Not Configured" : planName)).append(',')
                    .append(csv(String.valueOf(r[7]))).append(',')
                    .append(csv(created)).append(',')
                    .append(csv(renewal)).append(',')
                    .append(csv(String.valueOf(((Number) r[12]).longValue()))).append(',')
                    .append(csv(String.valueOf(((Number) r[13]).longValue()))).append(',')
                    .append(csv("--")).append(',')
                    .append(csv(lastLogin)).append(',')
                    .append(csv(subStatus == null ? "--" : subStatus.name())).append("\r\n");
        }
        return sb.toString();
    }

    // ── Internal query helpers ──────────────────────────────────────────────────

    private record Filters(String where, Map<String, Object> params) {
    }

    private Filters buildFilters(String search, String status, String plan, String state, String city, String ids) {
        StringBuilder w = new StringBuilder();
        Map<String, Object> params = new HashMap<>();

        if (ids != null && !ids.isBlank()) {
            List<String> idList = new ArrayList<>();
            for (String s : ids.split(",")) {
                if (!s.isBlank()) {
                    idList.add(s.trim());
                }
            }
            if (!idList.isEmpty()) {
                w.append(" AND p.id IN :ids");
                params.put("ids", idList);
            }
        }
        if (search != null && !search.isBlank()) {
            w.append(" AND (LOWER(p.name) LIKE :search OR LOWER(COALESCE(p.email, '')) LIKE :search")
                    .append(" OR LOWER(COALESCE(p.phone, '')) LIKE :search OR LOWER(COALESCE(p.gstin, '')) LIKE :search")
                    .append(" OR LOWER(COALESCE(p.tenantCode, '')) LIKE :search)");
            params.put("search", "%" + search.toLowerCase() + "%");
        }
        if (status != null && !"ALL".equals(status)) {
            if ("ACTIVE".equals(status)) {
                w.append(" AND p.isActive = true");
            } else if ("INACTIVE".equals(status)) {
                w.append(" AND p.isActive = false");
            } else {
                w.append(" AND CAST(p.tenantStatus AS string) = :tstatus");
                params.put("tstatus", status);
            }
        }
        if (plan != null && !plan.isBlank()) {
            w.append(" AND s.planName = :plan");
            params.put("plan", plan);
        }
        if (state != null && !state.isBlank()) {
            w.append(" AND LOWER(p.state) = :state");
            params.put("state", state.toLowerCase());
        }
        if (city != null && !city.isBlank()) {
            w.append(" AND LOWER(p.city) = :city");
            params.put("city", city.toLowerCase());
        }
        return new Filters(w.toString(), params);
    }

    private long countRows(Filters f) {
        Query q = entityManager.createQuery(
                "SELECT COUNT(p) FROM Pharmacy p LEFT JOIN Subscription s ON s.pharmacyId = p.id WHERE 1=1" + f.where());
        f.params().forEach(q::setParameter);
        return ((Number) q.getSingleResult()).longValue();
    }

    private List<Object[]> queryRows(Filters f, String order, int offset, int limit) {
        String jpql = """
                SELECT p.id, p.tenantCode, p.name, p.slug, p.state, p.city, p.isActive, p.tenantStatus, p.createdAt,
                       s.planName, s.status, s.validUntil,
                       (SELECT COUNT(d) FROM Doctor d WHERE d.pharmacyId = p.id),
                       (SELECT COUNT(c) FROM Customer c WHERE c.pharmacyId = p.id)
                FROM Pharmacy p LEFT JOIN Subscription s ON s.pharmacyId = p.id
                WHERE 1=1""" + f.where() + " ORDER BY " + order;
        @SuppressWarnings("unchecked")
        Query q = entityManager.createQuery(jpql);
        f.params().forEach(q::setParameter);
        q.setFirstResult(offset);
        q.setMaxResults(limit);
        @SuppressWarnings("unchecked")
        List<Object[]> rows = q.getResultList();
        return rows;
    }

    private Map<String, User> ownersByPharmacy(List<Object[]> rows) {
        if (rows.isEmpty()) {
            return Map.of();
        }
        List<String> ids = rows.stream().map(r -> (String) r[0]).toList();
        Map<String, User> map = new LinkedHashMap<>();
        for (User u : userRepository.findByPharmacyIdInAndRole(ids, Role.OWNER)) {
            map.putIfAbsent(u.getPharmacyId(), u); // first owner per tenant wins
        }
        return map;
    }

    private static SubscriptionInfo subscriptionFromRow(Object[] r) {
        String planName = (String) r[9];
        if (planName == null) {
            return null;
        }
        SubscriptionStatus st = (SubscriptionStatus) r[10];
        return new SubscriptionInfo(planName, st == null ? null : st.name(), null, null, toInstant(r[11]), null);
    }

    private static String sortColumn(String sortBy) {
        return switch (sortBy == null ? "createdAt" : sortBy) {
            case "name" -> "p.name";
            case "doctors" -> "(SELECT COUNT(d) FROM Doctor d WHERE d.pharmacyId = p.id)";
            case "patients" -> "(SELECT COUNT(c) FROM Customer c WHERE c.pharmacyId = p.id)";
            default -> "p.createdAt";
        };
    }

    private OnboardCommand toCommand(CreateTenantRequest req, String passwordHash) {
        return new OnboardCommand(
                req.name(), req.gstin(), req.drugLicense(), req.phone(), req.email(), req.address(), req.city(),
                req.state(), req.pincode(),
                true, req.ownerName(), req.ownerEmail(), req.ownerPhone(), passwordHash,
                req.planName() == null ? PlanPricing.DEFAULT_PLAN : req.planName(), PlanPricing.DEFAULT_BILLING_CYCLE,
                orDefault(req.doctorLimit(), 5), orDefault(req.staffLimit(), 5), orDefault(req.patientLimit(), 500),
                orDefault(req.storageLimit(), 1024),
                orDefault(req.enableBilling(), true), orDefault(req.enableInventory(), true),
                orDefault(req.enableEmr(), false), orDefault(req.enableCrm(), false),
                orDefault(req.enableWhatsapp(), false), orDefault(req.enableSms(), false),
                orDefault(req.enableApiAccess(), false), orDefault(req.enableOnlineBooking(), false));
    }

    private static boolean revokesSessions(String status) {
        return "SUSPENDED".equals(status) || "ARCHIVED".equals(status) || "EXPIRED".equals(status);
    }

    private static String generatePassword() {
        StringBuilder sb = new StringBuilder(PW_LEN);
        for (int i = 0; i < PW_LEN; i++) {
            sb.append(PW_CHARS.charAt(RNG.nextInt(PW_CHARS.length())));
        }
        return sb.toString();
    }

    private static java.time.Instant toInstant(Object o) {
        return o == null ? null : (java.time.Instant) o;
    }

    private static int orDefault(Integer v, int def) {
        return v == null ? def : v;
    }

    private static boolean orDefault(Boolean v, boolean def) {
        return v == null ? def : v;
    }

    private static String orDash(String s) {
        return s == null ? "--" : s;
    }

    private static String safe(String s) {
        return s == null ? "" : s;
    }

    /** Per-row required-field guard so a bad import row yields a clear reason, not an NPE surfaced as "failed". */
    private static String validateImportRow(ImportTenantsRequest.Row row) {
        if (isBlank(row.name())) {
            return "name is required";
        }
        if (isBlank(row.ownerName())) {
            return "ownerName is required";
        }
        if (isBlank(row.ownerEmail())) {
            return "ownerEmail is required";
        }
        if (!row.ownerEmail().contains("@")) {
            return "ownerEmail '" + row.ownerEmail() + "' is not a valid email";
        }
        if (row.planName() != null && !PlanPricing.PLAN_NAMES.contains(row.planName())) {
            return "Unknown plan '" + row.planName() + "'";
        }
        return null;
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static String csv(String value) {
        return com.checkup.pharmacy.common.util.CsvField.escape(value);
    }
}
