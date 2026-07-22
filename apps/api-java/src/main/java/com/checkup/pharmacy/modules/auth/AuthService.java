package com.checkup.pharmacy.modules.auth;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.UnauthorizedException;
import com.checkup.pharmacy.common.enums.AuditModule;
import com.checkup.pharmacy.common.enums.AuditStatus;
import com.checkup.pharmacy.modules.audit.AuditEntry;
import com.checkup.pharmacy.modules.audit.AuditService;
import com.checkup.pharmacy.modules.auth.dto.AuthUser;
import com.checkup.pharmacy.modules.auth.dto.ChangePasswordRequest;
import com.checkup.pharmacy.modules.auth.dto.ForgotPasswordRequest;
import com.checkup.pharmacy.modules.auth.dto.LoginRequest;
import com.checkup.pharmacy.modules.auth.dto.MeResponse;
import com.checkup.pharmacy.modules.auth.dto.RegisterRequest;
import com.checkup.pharmacy.modules.auth.dto.ResetPasswordRequest;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.security.JwtService;
import com.checkup.pharmacy.security.JwtPayload;
import com.checkup.pharmacy.security.TokenPair;
import com.checkup.pharmacy.tenant.CrossTenant;
import io.jsonwebtoken.JwtException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Locale;

/**
 * Authentication business logic. Every method that touches the DB is
 * transactional; entities are mapped to DTOs here so they never leak past the
 * module boundary.
 */
@Service
public class AuthService {

    private static final Duration RESET_TOKEN_TTL = Duration.ofHours(1);
    private static final SecureRandom RNG = new SecureRandom();
    private static final java.util.Set<Role> PLATFORM_ROLES =
            java.util.Set.of(Role.PLATFORM_ADMIN, Role.SUPPORT_AGENT);

    private final UserRepository userRepository;
    private final PharmacyRepository pharmacyRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final AuditService auditService;

    public AuthService(UserRepository userRepository,
                       PharmacyRepository pharmacyRepository,
                       PasswordEncoder passwordEncoder,
                       JwtService jwtService,
                       AuditService auditService) {
        this.userRepository = userRepository;
        this.pharmacyRepository = pharmacyRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.auditService = auditService;
    }

    /** Carries the user DTO plus freshly issued tokens back to the controller. */
    public record AuthResult(AuthUser user, TokenPair tokens) {
    }

    @CrossTenant("Signup creates the pharmacy itself — there is no tenant to scope to yet.")
    @Transactional
    public AuthResult register(RegisterRequest req) {
        if (userRepository.existsByEmail(req.email())) {
            throw new ConflictException("An account with this email already exists");
        }

        Pharmacy pharmacy = Pharmacy.create(req.pharmacyName(), uniqueSlug(req.pharmacyName()));
        pharmacy.setPhone(req.phone());
        pharmacy.setEmail(req.email());
        pharmacy.setCity(req.city());
        pharmacy.setState(req.state());
        pharmacy.setPincode(req.pincode());
        pharmacy.setAddress(req.address());
        pharmacy.setGstin(req.gstin());
        pharmacy.setDrugLicense(req.drugLicense());
        pharmacyRepository.save(pharmacy);

        User user = User.create(
                pharmacy.getId(),
                req.ownerName(),
                req.email(),
                req.phone(),
                passwordEncoder.encode(req.password()),
                Role.OWNER);
        userRepository.save(user);

        TokenPair tokens = jwtService.issueTokens(user);

        auditService.log(AuditEntry.of(AuditModule.AUTH, "REGISTER", "USER")
                .pharmacyId(pharmacy.getId()).userId(user.getId()).userEmail(user.getEmail())
                .entityId(user.getId()).resourceName(pharmacy.getName()));

        return new AuthResult(toAuthUser(user, pharmacy.getName()), tokens);
    }

    @CrossTenant("Looks the user up by email; the tenant is derived FROM that row, so it cannot scope the query.")
    @Transactional
    public AuthResult login(LoginRequest req) {
        User user = userRepository.findByEmail(req.email()).orElse(null);

        if (user == null || !user.isActive() || !passwordEncoder.matches(req.password(), user.getPasswordHash())) {
            // logDurable (own transaction) so the failed-login record survives this
            // method throwing — it references only already-committed rows, so it's safe.
            auditService.logDurable(AuditEntry.of(AuditModule.AUTH, "LOGIN_FAILED", "USER")
                    .userEmail(req.email())
                    .status(AuditStatus.FAILED)
                    .pharmacyId(user != null ? user.getPharmacyId() : null)
                    .userId(user != null ? user.getId() : null));
            throw new UnauthorizedException("Invalid email or password");
        }

        // A pharmacy that a platform admin suspended/archived must actually stay
        // locked out, not just interrupted. updateTenantStatus/bulkAction bump every
        // affected user's tokenVersion, which invalidates every OUTSTANDING token —
        // but login() issues a fresh token embedding whatever tokenVersion is
        // current, so without this check a suspended tenant's user could log
        // straight back in immediately after being kicked out. Suspension would
        // cost them one re-login, not access.
        //
        // Exempt PLATFORM_ROLES: they are platform staff, not a pharmacy's tenant
        // users, and their account row's own isActive flag (checked above) already
        // governs their access. Gating them on pharmacy.isActive too would let one
        // fat-fingered bulk-suspend (or the platform's own service pharmacy ever
        // being toggled) lock out every admin and support agent at once, with no
        // remaining path back in.
        if (!PLATFORM_ROLES.contains(user.getRole())
                && (user.getPharmacy() == null || !user.getPharmacy().isActive())) {
            auditService.logDurable(AuditEntry.of(AuditModule.AUTH, "LOGIN_FAILED", "USER")
                    .userEmail(req.email())
                    .status(AuditStatus.FAILED)
                    .pharmacyId(user.getPharmacyId()).userId(user.getId()));
            throw new UnauthorizedException(
                    "This pharmacy's account is currently suspended. Contact support for help.");
        }

        user.recordLogin();
        TokenPair tokens = jwtService.issueTokens(user);
        String pharmacyName = user.getPharmacy() != null ? user.getPharmacy().getName() : null;

        auditService.log(AuditEntry.of(AuditModule.AUTH, "LOGIN_SUCCESS", "USER")
                .pharmacyId(user.getPharmacyId()).userId(user.getId()).userEmail(user.getEmail())
                .entityId(user.getId()));

        return new AuthResult(toAuthUser(user, pharmacyName), tokens);
    }

    /**
     * Rotates the session: validates the refresh token, then bumps tokenVersion so
     * the presented refresh token can never be reused, and issues a new pair.
     */
    @CrossTenant("Runs on an unauthenticated route; the tenant comes from the refresh token's subject.")
    @Transactional
    public TokenPair refresh(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) {
            throw new UnauthorizedException("No refresh token");
        }

        JwtPayload payload;
        try {
            payload = jwtService.verify(refreshToken);
        } catch (JwtException | IllegalArgumentException ex) {
            throw new UnauthorizedException("Invalid refresh token");
        }
        if (!"refresh".equals(payload.type())) {
            throw new UnauthorizedException("Invalid refresh token");
        }

        User user = userRepository.findById(payload.sub())
                .orElseThrow(() -> new UnauthorizedException("Invalid refresh token"));
        if (!user.isActive() || user.getTokenVersion() != payload.tokenVersion()) {
            throw new UnauthorizedException("Invalid refresh token");
        }

        user.bumpTokenVersion();
        return jwtService.issueTokens(user);
    }

    @Transactional
    public void logout(String userId) {
        // Bumping tokenVersion invalidates every outstanding access + refresh token.
        userRepository.findById(userId).ifPresent(User::bumpTokenVersion);
    }

    @Transactional
    public void changePassword(String userId, ChangePasswordRequest req) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UnauthorizedException("Unauthorized"));

        if (!passwordEncoder.matches(req.currentPassword(), user.getPasswordHash())) {
            throw new BadRequestException("Current password is incorrect");
        }

        user.setPasswordHash(passwordEncoder.encode(req.newPassword()));
        user.bumpTokenVersion(); // force re-login everywhere
    }

    /** Always succeeds (never reveals whether the email is registered). */
    @CrossTenant("Unauthenticated route; the user is found by email across all pharmacies.")
    @Transactional
    public void forgotPassword(ForgotPasswordRequest req) {
        userRepository.findByEmail(req.email()).ifPresent(user -> {
            String rawToken = randomToken();
            user.setResetToken(sha256(rawToken), Instant.now().plus(RESET_TOKEN_TTL));
            // TODO: email the raw token as a reset link once the mailer module exists.
        });
    }

    @CrossTenant("Unauthenticated route; the user is found by reset-token hash, which carries no tenant.")
    @Transactional
    public void resetPassword(ResetPasswordRequest req) {
        User user = userRepository.findByPasswordResetToken(sha256(req.token()))
                .orElseThrow(() -> new BadRequestException("Invalid or expired reset link"));

        Instant expiry = user.getPasswordResetTokenExpiresAt();
        if (expiry == null || expiry.isBefore(Instant.now())) {
            throw new BadRequestException("Invalid or expired reset link");
        }

        user.setPasswordHash(passwordEncoder.encode(req.password()));
        user.clearResetToken();
        user.bumpTokenVersion();
    }

    @Transactional(readOnly = true)
    public MeResponse me(String userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new NotFoundException("User not found"));
        return toMeResponse(user);
    }

    @Transactional
    public MeResponse updateProfile(String userId, String name) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new NotFoundException("User not found"));
        user.rename(name.trim());
        return toMeResponse(user);
    }

    // ── Mapping ────────────────────────────────────────────────────────────────

    private AuthUser toAuthUser(User user, String pharmacyName) {
        return new AuthUser(
                user.getId(),
                user.getName(),
                user.getEmail(),
                user.getRole().name(),
                user.getPharmacyId(),
                pharmacyName);
    }

    private MeResponse toMeResponse(User user) {
        Pharmacy pharmacy = user.getPharmacy();
        MeResponse.PharmacySummary summary = pharmacy == null
                ? null
                : new MeResponse.PharmacySummary(pharmacy.getName(), pharmacy.getGstin(), pharmacy.getDrugLicense());
        return new MeResponse(
                user.getId(),
                user.getName(),
                user.getEmail(),
                user.getRole().name(),
                user.getPharmacyId(),
                summary);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private String uniqueSlug(String name) {
        String base = slugify(name);
        if (base.isEmpty()) {
            base = "pharmacy";
        }
        String slug = base;
        while (pharmacyRepository.existsBySlug(slug)) {
            slug = base + "-" + Integer.toString(RNG.nextInt(0x10000), 36);
        }
        return slug;
    }

    private static String slugify(String s) {
        return s.toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("(^-+|-+$)", "");
    }

    private static String randomToken() {
        byte[] buf = new byte[32];
        RNG.nextBytes(buf);
        return HexFormat.of().formatHex(buf);
    }

    private static String sha256(String value) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
