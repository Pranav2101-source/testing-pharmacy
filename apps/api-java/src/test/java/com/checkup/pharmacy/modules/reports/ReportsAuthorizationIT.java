package com.checkup.pharmacy.modules.reports;

import com.checkup.pharmacy.common.enums.Role;
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
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Who may read the reports.
 *
 * <p>The web app has always route-guarded {@code /dashboard/reports} to OWNER and MANAGER,
 * commented "financial data" — but a guard in the browser only stops a cashier opening the
 * screen. Their token still read the pharmacy's stock valuation at cost, its dead-stock
 * exposure and its supplier purchase prices straight from the API. The class-level
 * {@code @PreAuthorize} closed that; this suite is what stops it drifting back open.
 *
 * <p>Deliberately calls the CONTROLLER bean, not the service. Method security is applied by
 * an AOP proxy around the bean carrying the annotation, so a test that went through
 * {@link ReportsService} would exercise the query and prove nothing at all about access —
 * and would pass just as happily with the annotation deleted.
 *
 * <p>Both directions are asserted. A test that only checks the denial would still pass if
 * someone locked down the two exempt endpoints, silently breaking the Home page and the
 * Purchase page for every role that has no other view of them.
 */
@Transactional
class ReportsAuthorizationIT extends AbstractPostgresIT {

    @Autowired private ReportsController reportsController;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String cashierId;
    private String managerId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Auth Pharmacy", "ph-" + unique()));
        pharmacyId = pharmacy.getId();
        cashierId = userRepository.save(User.create(pharmacyId, "Till Staff",
                "cashier-" + unique() + "@test.local", "9000000010", "hash", Role.CASHIER)).getId();
        managerId = userRepository.save(User.create(pharmacyId, "Shop Manager",
                "manager-" + unique() + "@test.local", "9000000011", "hash", Role.MANAGER)).getId();
        entityManager.flush();
        entityManager.clear();
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    @Test
    @DisplayName("a cashier cannot read cost, profit or valuation through the API")
    void cashierIsDeniedCommercialReports() {
        authenticateAs(cashierId, pharmacyId, Role.CASHIER);

        // Each of these exposes what the pharmacy paid or what it earned. The margin report
        // is the newest; the other three predate it and were open to any authenticated user.
        assertThatThrownBy(() -> reportsController.salesMargin(null, null, null))
                .isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> reportsController.valuation("category"))
                .isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> reportsController.costAnalysis(null, null, null))
                .isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> reportsController.deadStock(90, null))
                .isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> reportsController.dailySalesSeries(null, null, null))
                .isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> reportsController.gst(null, null))
                .isInstanceOf(AccessDeniedException.class);
    }

    @Test
    @DisplayName("the two screens every role opens keep working for a cashier")
    void cashierKeepsTheOperationalEndpoints() {
        authenticateAs(cashierId, pharmacyId, Role.CASHIER);

        // Home page's end-of-day widget.
        assertThatCode(() -> reportsController.eodSummary()).doesNotThrowAnyException();
        // Purchase page's draft / overdue / pending-approval counters.
        assertThatCode(() -> reportsController.purchaseSummary(null, null)).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a manager reads everything the reports screen shows")
    void managerReadsTheWholeScreen() {
        authenticateAs(managerId, pharmacyId, Role.MANAGER);

        assertThat(reportsController.salesMargin(null, null, null).data()).isNotNull();
        assertThat(reportsController.valuation("category").data()).isNotNull();
        assertThat(reportsController.costAnalysis(null, null, null).data()).isNotNull();
        assertThat(reportsController.eodSummary().data()).isNotNull();
    }
}
