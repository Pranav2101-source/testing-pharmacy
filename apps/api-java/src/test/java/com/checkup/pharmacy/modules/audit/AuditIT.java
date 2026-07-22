package com.checkup.pharmacy.modules.audit;

import com.checkup.pharmacy.common.enums.AuditModule;
import com.checkup.pharmacy.common.enums.AuditSeverity;
import com.checkup.pharmacy.common.enums.AuditStatus;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The platform-admin audit trail: cross-tenant by design (see the class
 * javadoc on {@link AuditService}), so unlike almost every other module tested
 * this session, its read methods carry no {@code pharmacyId} filter at all —
 * that is correct here, not a scoping gap, and is what
 * {@code @PreAuthorize("hasRole('PLATFORM_ADMIN')")} on every
 * {@link AuditController} endpoint exists to gate.
 *
 * <p>{@code log()} is REQUIRED propagation (joins this test's transaction), so
 * this class stays {@code @Transactional} like most ITs — unlike AuthIT/
 * SupportIT/CalendarIT/NotificationIT, which all depend on
 * {@code logDurable()}/{@code inAppNotify()}'s REQUIRES_NEW instead.
 */
@Transactional
class AuditIT extends AbstractPostgresIT {

    @Autowired private AuditService auditService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String userId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Audited Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        pharmacyId = pharmacy.getId();
        userId = user.getId();
        flushAndClear();
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    /**
     * AuditLog.pharmacy is a lazy @ManyToOne, populated only when Hibernate loads
     * the row from the database. auditService.log() constructs and saves a fresh
     * AuditLog with that relation never touched, and — since everything here runs
     * in one transaction — a subsequent query for the same row returns the SAME
     * cached instance from the first-level cache rather than a genuine reload, so
     * `pharmacy` stays null even though the read-side query fetch-joins it. Flush
     * and clear between writing and reading forces the next query to actually hit
     * the database.
     */
    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    private void logEvent(AuditModule module, String action, AuditStatus status) {
        auditService.log(AuditEntry.of(module, action, "TEST_ENTITY")
                .pharmacyId(pharmacyId).userId(userId).userEmail("owner@test.local")
                .status(status));
        flushAndClear();
    }

    @Test
    @DisplayName("a logged event appears in the list, joined with its pharmacy and user")
    void loggedEventAppearsInList() {
        logEvent(AuditModule.BILLING, "INVOICE_CREATED", AuditStatus.SUCCESS);

        var result = auditService.list(null, null, null, null, null, null, null, 1, 50);

        assertThat(result.items()).anySatisfy(item -> {
            assertThat(item.action()).isEqualTo("INVOICE_CREATED");
            assertThat(item.pharmacy().name()).isEqualTo("Audited Pharmacy");
        });
    }

    @Test
    @DisplayName("listing can be filtered by module")
    void listFiltersByModule() {
        logEvent(AuditModule.BILLING, "MATCHING_MODULE_EVENT", AuditStatus.SUCCESS);
        logEvent(AuditModule.INVENTORY, "OTHER_MODULE_EVENT", AuditStatus.SUCCESS);

        var result = auditService.list(null, "BILLING", null, null, null, null, null, 1, 50);

        assertThat(result.items()).extracting(i -> i.action())
                .contains("MATCHING_MODULE_EVENT")
                .doesNotContain("OTHER_MODULE_EVENT");
    }

    @Test
    @DisplayName("KPIs count failed actions separately from total events")
    void kpisCountFailuresSeparately() {
        logEvent(AuditModule.AUTH, "LOGIN_ATTEMPT_1", AuditStatus.SUCCESS);
        logEvent(AuditModule.AUTH, "LOGIN_ATTEMPT_2", AuditStatus.FAILED);

        var kpis = auditService.kpis("AUTH", null, null, null);

        assertThat(kpis.totalEvents()).isGreaterThanOrEqualTo(2);
        assertThat(kpis.failedActions()).isGreaterThanOrEqualTo(1);
    }

    @Test
    @DisplayName("a specific event can be fetched by id")
    void eventFetchableById() {
        auditService.log(AuditEntry.of(AuditModule.SUPPORT, "TICKET_CREATED", "SUPPORT_TICKET")
                .pharmacyId(pharmacyId).userId(userId).resourceName("SUP-2026-000001"));
        flushAndClear();

        String id = auditService.list(null, null, "TICKET_CREATED", null, null, null, null, 1, 1)
                .items().get(0).id();

        assertThat(auditService.getById(id).resourceName()).isEqualTo("SUP-2026-000001");
    }

    @Test
    @DisplayName("an unknown audit log id is reported as not found")
    void unknownIdIsNotFound() {
        assertThatThrownBy(() -> auditService.getById("does-not-exist"))
                .isInstanceOf(NotFoundException.class);
    }

    @Test
    @DisplayName("the timeline for an entity returns only that entity's events")
    void timelineScopedToOneEntity() {
        auditService.log(AuditEntry.of(AuditModule.INVENTORY, "STOCK_ADJUSTED", "INVENTORY")
                .pharmacyId(pharmacyId).userId(userId).entityId("batch-1"));
        auditService.log(AuditEntry.of(AuditModule.INVENTORY, "STOCK_ADJUSTED", "INVENTORY")
                .pharmacyId(pharmacyId).userId(userId).entityId("batch-2"));
        flushAndClear();

        var timeline = auditService.timeline("INVENTORY", "batch-1");

        assertThat(timeline).allSatisfy(item -> assertThat(item.entityId()).isEqualTo("batch-1"));
    }

    @Test
    @DisplayName("an incomplete timeline request (missing entity or entityId) returns nothing, not an error")
    void incompleteTimelineRequestReturnsEmpty() {
        assertThat(auditService.timeline(null, "batch-1")).isEmpty();
        assertThat(auditService.timeline("INVENTORY", null)).isEmpty();
    }

    /**
     * The CWE-1236 fix, exercised at the point it actually matters: a real
     * pharmacy name flowing through to what {@code forExport} returns.
     * {@link com.checkup.pharmacy.common.util.CsvFieldTest} proves the escaper
     * itself is correct; this proves the audit trail's own attacker-reachable
     * field (pharmacy name) reaches export as ordinary, unescaped data — the
     * neutralization happens once, at serialization, in AuditController's
     * buildCsv, not by mangling what's stored.
     */
    @Test
    @DisplayName("a pharmacy named like a spreadsheet formula is exported as plain data")
    void maliciousPharmacyNameSurvivesToExport() {
        Pharmacy malicious = pharmacyRepository.save(
                Pharmacy.create("=HYPERLINK(\"http://evil.example\",\"click\")", "ph-" + unique()));
        auditService.log(AuditEntry.of(AuditModule.TENANTS, "TENANT_CREATED", "PHARMACY")
                .pharmacyId(malicious.getId()).userId(userId).entityId(malicious.getId()));
        flushAndClear();

        var rows = auditService.forExport("TENANTS", "TENANT_CREATED", null, null);

        assertThat(rows).anySatisfy(row ->
                assertThat(row.getPharmacy().getName()).startsWith("=HYPERLINK"));
        // AuditController.buildCsv is what neutralizes it (CsvField.escape on every
        // field) — verified directly in CsvFieldTest. This confirms the raw value
        // reaches that point intact, i.e. nothing upstream already mangled it in a
        // way that would make the escaper's job trivial or the test misleading.
    }
}
