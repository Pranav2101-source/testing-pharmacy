package com.checkup.pharmacy.modules.platform.tenant;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.modules.auth.AuthService;
import com.checkup.pharmacy.modules.auth.dto.LoginRequest;
import com.checkup.pharmacy.modules.auth.dto.RegisterRequest;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.platform.tenant.dto.CreateTenantRequest;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Platform-admin tenant provisioning and lifecycle (suspend/activate/archive).
 *
 * <p>Not {@code @Transactional} — {@code onboard()}'s audit writes are REQUIRED
 * propagation specifically so they see the pharmacy this same call just created
 * (see that class's javadoc), which is correct and fine under a rollback-scoped
 * test. The reason this class still avoids {@code @Transactional} is
 * {@link AuthService#login}, exercised here end-to-end to prove suspension
 * actually blocks access — its own LOGIN_FAILED/LOGIN_SUCCESS audit writes use
 * {@code REQUIRES_NEW} (AuthService's own javadoc), which needs the tenant this
 * test created to be genuinely committed. Same reasoning as AuthIT.
 */
class TenantIT extends AbstractPostgresIT {

    @Autowired private PharmacyOnboardingService onboardingService;
    @Autowired private TenantService tenantService;
    @Autowired private AuthService authService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private PasswordEncoder passwordEncoder;

    private String actorId;

    /**
     * A real, authenticated PLATFORM_ADMIN — not a made-up id string. Two reasons
     * this is required, not just tidy: audit_logs.userId is a genuine FK to users,
     * so a fake actor id fails at INSERT; and onboard() now calls
     * DuplicateSubmitGuard.guard(), which reads TenantContext.currentUser() to build
     * its fingerprint key — in production that's always populated by the JWT filter
     * before a controller runs, but calling the service directly in a test skips
     * that, so it has to be set up explicitly here.
     */
    @BeforeEach
    void seedActor() {
        Pharmacy adminHome = pharmacyRepository.save(Pharmacy.create("Platform Staff", "platform-" + unique()));
        User admin = userRepository.save(User.create(adminHome.getId(), "Platform Admin",
                "actor-" + unique() + "@test.local", "9000000099",
                passwordEncoder.encode("irrelevant"), Role.PLATFORM_ADMIN));
        actorId = admin.getId();
        authenticateAs(actorId, adminHome.getId(), Role.PLATFORM_ADMIN);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private OnboardCommand command(String name, String ownerEmail) {
        // Field order: name, gstin, drugLicense, phone, email, address, city, state,
        // pincode, createOwner, ownerName, ownerEmail, ownerPhone, ownerPasswordHash,
        // planName, billingCycle, doctorLimit, staffLimit, patientLimit, storageLimit,
        // then the 8 enable* booleans.
        return new OnboardCommand(name, null, null, null, null, null, null, null, null,
                true, "Owner", ownerEmail, "9000000000", "{bcrypt}fake-hash",
                null, null, 0, 0, 0, 0, false, false, false, false, false, false, false, false);
    }

    @Test
    @DisplayName("onboarding provisions a pharmacy, subscription, settings and owner together")
    void onboardingProvisionsEverything() {
        String name = "Onboard Test Pharmacy " + unique();
        var result = onboardingService.onboard(command(name, "owner-" + unique() + "@test.local"),
                actorId, "admin@platform.local");

        assertThat(result.pharmacy().getId()).isNotBlank();
        assertThat(result.subscription().getPharmacyId()).isEqualTo(result.pharmacy().getId());
        assertThat(result.settings().getPharmacyId()).isEqualTo(result.pharmacy().getId());
        assertThat(result.owner().getPharmacyId()).isEqualTo(result.pharmacy().getId());
        assertThat(result.owner().getRole()).isEqualTo(Role.OWNER);
    }

    @Test
    @DisplayName("two pharmacies with the identical name are refused")
    void duplicateNameIsRefused() {
        String name = "Duplicate Name Test " + unique();
        onboardingService.onboard(command(name, "owner1-" + unique() + "@test.local"), actorId, "admin@platform.local");

        assertThatThrownBy(() -> onboardingService.onboard(
                command(name, "owner2-" + unique() + "@test.local"), actorId, "admin@platform.local"))
                .isInstanceOf(ConflictException.class);
    }

    /**
     * The gap this pins: pharmacy NAME carries no DB uniqueness constraint (see the
     * comment in PharmacyOnboardingService), so the ONLY thing standing between a
     * double-submitted "Create Tenant" click and two identical tenants was a plain
     * check-then-act with no lock. Every other create endpoint in this codebase
     * already had DuplicateSubmitGuard; onboarding — the single most consequential
     * creation of all — did not.
     */
    @Test
    @DisplayName("submitting the identical onboarding command twice in a row is refused as a duplicate")
    void identicalResubmissionIsRefused() {
        var cmd = command("Resubmit Test Pharmacy " + unique(), "owner-" + unique() + "@test.local");
        onboardingService.onboard(cmd, actorId, "admin@platform.local");

        assertThatThrownBy(() -> onboardingService.onboard(cmd, actorId, "admin@platform.local"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("duplicate");
    }

    @Test
    @DisplayName("createTenant (the admin-facing entry point) delegates through to onboarding")
    void createTenantDelegatesToOnboarding() {
        // Field order: name, gstin, drugLicense, address, city, state, pincode,
        // phone, email, ownerName, ownerEmail, ownerPhone, planName, then the four
        // *Limit Integers and eight enable* Booleans.
        var req = new CreateTenantRequest("Admin Created Pharmacy " + unique(), null, null, null, null, null, null,
                null, null, "Owner Name", "owner-" + unique() + "@test.local", null, null,
                null, null, null, null, null, null, null, null, null, null, null, null);

        var response = tenantService.createTenant(req, actorId, "admin@platform.local");

        assertThat(response.pharmacy().tenantCode()).isNotBlank();
        assertThat(response.temporaryPassword()).isNotBlank();
    }

    /**
     * End-to-end: suspending a tenant must not just interrupt an existing session,
     * it must keep the tenant locked out. Before the fix, login() issued a fresh
     * token embedding whatever tokenVersion happened to be current, with no check
     * on the pharmacy's own status — so a suspended tenant's user could simply log
     * back in immediately after being kicked out.
     */
    @Test
    @DisplayName("a user of a newly-suspended tenant cannot log back in")
    void suspendingTenantBlocksFutureLogin() {
        String email = "suspend-test-" + unique() + "@test.local";
        String password = "correct-horse-battery";
        var register = authService.register(new RegisterRequest(
                "Suspend Test Pharmacy " + unique(), "Owner", "9876543210", email, password,
                null, null, null, null, null, null));
        String pharmacyId = register.user().pharmacyId();

        // Confirm the tenant works before suspension.
        assertThat(authService.login(new LoginRequest(email, password)).user().email()).isEqualTo(email);

        tenantService.updateTenantStatus(pharmacyId, "SUSPENDED", actorId);

        assertThatThrownBy(() -> authService.login(new LoginRequest(email, password)))
                .hasMessageContaining("suspended");
    }

    @Test
    @DisplayName("re-activating a suspended tenant restores login")
    void reactivatingTenantRestoresLogin() {
        String email = "reactivate-test-" + unique() + "@test.local";
        String password = "correct-horse-battery";
        var register = authService.register(new RegisterRequest(
                "Reactivate Test Pharmacy " + unique(), "Owner", "9876543211", email, password,
                null, null, null, null, null, null));
        String pharmacyId = register.user().pharmacyId();

        tenantService.updateTenantStatus(pharmacyId, "SUSPENDED", actorId);
        tenantService.updateTenantStatus(pharmacyId, "ACTIVE", actorId);

        assertThat(authService.login(new LoginRequest(email, password)).user().email()).isEqualTo(email);
    }

    @Test
    @DisplayName("bulk-suspending a tenant blocks login the same way a single suspend does")
    void bulkSuspendBlocksLogin() {
        String email = "bulk-suspend-" + unique() + "@test.local";
        String password = "correct-horse-battery";
        var register = authService.register(new RegisterRequest(
                "Bulk Suspend Test Pharmacy " + unique(), "Owner", "9876543212", email, password,
                null, null, null, null, null, null));
        String pharmacyId = register.user().pharmacyId();

        tenantService.bulkAction(List.of(pharmacyId), "SUSPEND", actorId);

        assertThatThrownBy(() -> authService.login(new LoginRequest(email, password)))
                .hasMessageContaining("suspended");
    }

    @Test
    @DisplayName("an invalid status value is rejected")
    void invalidStatusIsRejected() {
        String name = "Invalid Status Test " + unique();
        var result = onboardingService.onboard(command(name, "owner-" + unique() + "@test.local"),
                actorId, "admin@platform.local");

        assertThatThrownBy(() -> tenantService.updateTenantStatus(result.pharmacy().getId(), "DELETED", actorId))
                .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class);
    }
}
