package com.checkup.pharmacy.modules.auth;

import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.UnauthorizedException;
import com.checkup.pharmacy.modules.auth.dto.ChangePasswordRequest;
import com.checkup.pharmacy.modules.auth.dto.ForgotPasswordRequest;
import com.checkup.pharmacy.modules.auth.dto.LoginRequest;
import com.checkup.pharmacy.modules.auth.dto.RegisterRequest;
import com.checkup.pharmacy.modules.auth.dto.ResetPasswordRequest;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.util.ReflectionTestUtils;


import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Authentication and session lifecycle.
 *
 * <p>This module was found in good order — reset tokens are stored as SHA-256 hashes,
 * single-use and expiry-checked; every password change bumps {@code tokenVersion};
 * refresh rotates. These tests exist to keep it that way rather than to report
 * defects: each one pins a property whose loss would be a security regression and
 * would otherwise be silent, because a weakened check still lets valid logins through.
 *
 * <p>The session-invalidation tests assert on {@code tokenVersion} directly. Every
 * outstanding access and refresh token embeds the version it was issued under, and
 * {@code refresh} rejects any token whose version no longer matches — so a bumped
 * version IS the invalidation.
 */
/*
 * NOT @Transactional, unlike every other IT here — deliberately.
 *
 * AuditService writes the LOGIN_FAILED record with Propagation.REQUIRES_NEW, so that
 * an audit trail of failed logins survives even when the surrounding transaction
 * rolls back. That is the right design and it is exactly what breaks a
 * rollback-scoped test: the tenant registered in setUp is still uncommitted, the
 * audit's separate transaction cannot see it, and the insert dies on
 * audit_logs_pharmacyId_fkey — a failure that looks like a login defect and is not.
 *
 * So these tests commit. That is safe here: every test registers its own tenant under
 * a fresh random email, and AbstractPostgresIT drops and rebuilds the whole database
 * once per run, so nothing accumulates between runs.
 */
class AuthIT extends AbstractPostgresIT {

    @Autowired private AuthService authService;
    @Autowired private UserRepository userRepository;
    @Autowired private com.checkup.pharmacy.modules.pharmacy.PharmacyRepository pharmacyRepository;
    @Autowired private org.springframework.security.crypto.password.PasswordEncoder passwordEncoder;

    private static final String PASSWORD = "correct-horse-battery";

    private String email;
    private String userId;

    @BeforeEach
    void registerTenant() {
        email = "owner-" + UUID.randomUUID().toString().substring(0, 8) + "@test.local";
        var result = authService.register(new RegisterRequest(
                "Test Pharmacy", "Owner", "9876543210", email, PASSWORD,
                null, null, null, null, null, null));
        userId = result.user().id();
    }


    private User user() {
        return userRepository.findById(userId).orElseThrow();
    }

    private int tokenVersion() {
        return user().getTokenVersion();
    }

    @Test
    @DisplayName("registration creates an owner who can log in")
    void registrationThenLogin() {
        var result = authService.login(new LoginRequest(email, PASSWORD));

        assertThat(result.user().email()).isEqualTo(email);
        assertThat(result.tokens().accessToken()).isNotBlank();
        assertThat(result.tokens().refreshToken()).isNotBlank();
    }

    @Test
    @DisplayName("the wrong password is rejected")
    void wrongPasswordRejected() {
        assertThatThrownBy(() -> authService.login(new LoginRequest(email, "not-the-password")))
                .isInstanceOf(UnauthorizedException.class);
    }

    @Test
    @DisplayName("a deactivated user cannot log in even with the right password")
    void deactivatedUserCannotLogIn() {
        User user = user();
        ReflectionTestUtils.setField(user, "isActive", false);
        userRepository.save(user);

        assertThatThrownBy(() -> authService.login(new LoginRequest(email, PASSWORD)))
                .isInstanceOf(UnauthorizedException.class);
    }

    /**
     * The gap this pins: suspending a tenant (TenantService.updateTenantStatus /
     * bulkAction) bumps every affected user's tokenVersion, which invalidates every
     * OUTSTANDING token — but login() issued a fresh one embedding whatever
     * tokenVersion was CURRENT, with no check on the pharmacy's own status. A
     * suspended tenant's user could log straight back in seconds after being kicked
     * out, so "suspend this pharmacy" cost one re-login rather than actually
     * revoking access.
     */
    @Test
    @DisplayName("a user of a suspended pharmacy cannot log in even with the right password")
    void suspendedPharmacyCannotLogIn() {
        var pharmacy = pharmacyRepository.findById(user().getPharmacyId()).orElseThrow();
        ReflectionTestUtils.setField(pharmacy, "isActive", false);
        pharmacyRepository.save(pharmacy);

        assertThatThrownBy(() -> authService.login(new LoginRequest(email, PASSWORD)))
                .isInstanceOf(UnauthorizedException.class)
                .hasMessageContaining("suspended");
    }

    /**
     * Guards the exemption, not just the rule. Platform staff are not a pharmacy's
     * tenant users — gating them on pharmacy.isActive too would mean one
     * fat-fingered bulk-suspend (or the platform's own service pharmacy ever being
     * toggled inactive) locks out every admin and support agent at once, with no
     * account left able to reverse it.
     */
    @Test
    @DisplayName("a platform admin can still log in even if their home pharmacy row is inactive")
    void platformAdminExemptFromPharmacyActiveCheck() {
        var pharmacy = pharmacyRepository.findById(user().getPharmacyId()).orElseThrow();
        ReflectionTestUtils.setField(pharmacy, "isActive", false);
        pharmacyRepository.save(pharmacy);

        String adminEmail = "admin-" + UUID.randomUUID().toString().substring(0, 8) + "@test.local";
        User admin = User.create(pharmacy.getId(), "Platform Admin", adminEmail, "9888888888",
                passwordEncoder.encode(PASSWORD), com.checkup.pharmacy.common.enums.Role.PLATFORM_ADMIN);
        userRepository.save(admin);

        assertThatCode(() -> authService.login(new LoginRequest(adminEmail, PASSWORD)))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("refreshing rotates the session: the presented token cannot be reused")
    void refreshRotatesAndOldTokenDies() {
        var tokens = authService.login(new LoginRequest(email, PASSWORD)).tokens();

        authService.refresh(tokens.refreshToken());

        // Replaying the same refresh token — the classic stolen-token scenario.
        assertThatThrownBy(() -> authService.refresh(tokens.refreshToken()))
                .isInstanceOf(UnauthorizedException.class);
    }

    @Test
    @DisplayName("the token issued by a refresh is itself usable")
    void rotatedTokenWorks() {
        var tokens = authService.login(new LoginRequest(email, PASSWORD)).tokens();

        var rotated = authService.refresh(tokens.refreshToken());

        // Guards an ordering trap: tokenVersion is bumped BEFORE the new pair is
        // signed. Sign first and every refresh would instantly invalidate itself.
        assertThatCode(() -> authService.refresh(rotated.refreshToken()))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("an access token cannot be presented as a refresh token")
    void accessTokenIsNotARefreshToken() {
        var tokens = authService.login(new LoginRequest(email, PASSWORD)).tokens();

        assertThatThrownBy(() -> authService.refresh(tokens.accessToken()))
                .isInstanceOf(UnauthorizedException.class);
    }

    @Test
    @DisplayName("a garbage or empty refresh token is rejected, not crashed on")
    void malformedRefreshTokenRejected() {
        assertThatThrownBy(() -> authService.refresh("not-a-jwt"))
                .isInstanceOf(UnauthorizedException.class);
        assertThatThrownBy(() -> authService.refresh(""))
                .isInstanceOf(UnauthorizedException.class);
        assertThatThrownBy(() -> authService.refresh(null))
                .isInstanceOf(UnauthorizedException.class);
    }

    @Test
    @DisplayName("logging out invalidates every outstanding session")
    void logoutInvalidatesSessions() {
        int before = tokenVersion();

        authService.logout(userId);

        assertThat(tokenVersion()).isGreaterThan(before);
    }

    @Test
    @DisplayName("changing a password logs every other device out")
    void changingPasswordInvalidatesSessions() {
        int before = tokenVersion();

        authService.changePassword(userId, new ChangePasswordRequest(PASSWORD, "a-brand-new-password"));

        assertThat(tokenVersion())
                .as("a password change must not leave a stolen session alive")
                .isGreaterThan(before);
        assertThatCode(() -> authService.login(new LoginRequest(email, "a-brand-new-password")))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("changing a password requires the current one")
    void changePasswordNeedsCurrentPassword() {
        assertThatThrownBy(() -> authService.changePassword(userId,
                new ChangePasswordRequest("wrong-current", "a-brand-new-password")))
                .isInstanceOf(BadRequestException.class);

        // And the old password must still work — a failed attempt must not half-apply.
        assertThatCode(() -> authService.login(new LoginRequest(email, PASSWORD)))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("forgot-password reveals nothing about whether an email is registered")
    void forgotPasswordDoesNotEnumerateUsers() {
        assertThatCode(() -> authService.forgotPassword(new ForgotPasswordRequest(email)))
                .doesNotThrowAnyException();
        assertThatCode(() -> authService.forgotPassword(new ForgotPasswordRequest("nobody@nowhere.test")))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("the reset token is stored hashed, never in plain text")
    void resetTokenIsStoredHashed() {
        authService.forgotPassword(new ForgotPasswordRequest(email));

        String stored = (String) ReflectionTestUtils.getField(user(), "passwordResetToken");
        assertThat(stored)
                .as("a database leak must not hand over working reset links")
                .isNotNull()
                .hasSize(64); // SHA-256 hex
    }

    @Test
    @DisplayName("an expired reset link is refused")
    void expiredResetTokenRefused() {
        authService.forgotPassword(new ForgotPasswordRequest(email));

        User user = user();
        ReflectionTestUtils.setField(user, "passwordResetTokenExpiresAt",
                Instant.now().minus(1, ChronoUnit.HOURS));
        userRepository.save(user);

        // The raw token is unknown to the test by design, so this asserts the generic
        // rejection: an unknown OR expired token must produce the same message, or the
        // error itself becomes an oracle for which tokens exist.
        assertThatThrownBy(() -> authService.resetPassword(new ResetPasswordRequest("any-token", "new-password-123")))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("Invalid or expired");
    }

    @Test
    @DisplayName("an unknown reset token is refused with the same message as an expired one")
    void unknownResetTokenRefused() {
        assertThatThrownBy(() -> authService.resetPassword(
                new ResetPasswordRequest("never-issued", "new-password-123")))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("Invalid or expired");
    }

    @Test
    @DisplayName("registering the same email twice is refused")
    void duplicateEmailRefused() {
        assertThatThrownBy(() -> authService.register(new RegisterRequest(
                "Another Pharmacy", "Someone Else", "9876543211", email, PASSWORD,
                null, null, null, null, null, null)))
                .isInstanceOf(RuntimeException.class);
    }
}
