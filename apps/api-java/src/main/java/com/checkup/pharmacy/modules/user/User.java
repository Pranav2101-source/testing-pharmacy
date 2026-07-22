package com.checkup.pharmacy.modules.user;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.util.Cuid;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Locale;

/**
 * Maps the Prisma `User` model (table "users"). Login identity + auth state.
 *
 * Mapping notes:
 *  - Columns keep Prisma's camelCase names verbatim (see application.yml).
 *  - `role` is a Postgres enum — {@code @JdbcTypeCode(NAMED_ENUM)} reads and casts
 *    to the PG type on write.
 *  - `pharmacy` is a read-only association over the same `pharmacyId` column, used
 *    for building `/me` responses; the writable side is the `pharmacyId` scalar.
 */
@Entity
@Table(name = "users")
public class User extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "name")
    private String name;

    @Column(name = "email")
    private String email;

    @Column(name = "phone")
    private String phone;

    @Column(name = "passwordHash")
    private String passwordHash;

    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "role")
    private Role role;

    @Column(name = "isActive")
    private boolean isActive = true;

    @Column(name = "lastLoginAt")
    private Instant lastLoginAt;

    @Column(name = "tokenVersion")
    private int tokenVersion;

    @Column(name = "passwordResetToken")
    private String passwordResetToken;

    @Column(name = "passwordResetTokenExpiresAt")
    private Instant passwordResetTokenExpiresAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "pharmacyId", insertable = false, updatable = false)
    private Pharmacy pharmacy;

    protected User() {
        // Required by JPA.
    }

    /**
     * Creates a new user in the given tenant. The email is normalized (trimmed,
     * lower-cased) here — the single choke point every creation path (self-signup,
     * staff invite, platform onboarding, support/platform-admin creation) goes
     * through — so the case-insensitive lookups in {@link UserRepository} can rely
     * on the stored value always being canonical, and two people typing the "same"
     * email in different case can never end up as two separate accounts.
     */
    public static User create(String pharmacyId, String name, String email, String phone,
                              String passwordHash, Role role) {
        User u = new User();
        u.assignId(Cuid.generate());
        u.pharmacyId = pharmacyId;
        u.name = name;
        u.email = email == null ? null : email.trim().toLowerCase(Locale.ROOT);
        u.phone = phone;
        u.passwordHash = passwordHash;
        u.role = role;
        u.isActive = true;
        u.tokenVersion = 0;
        return u;
    }

    // ── Behaviour ─────────────────────────────────────────────────────────────

    public void recordLogin() {
        this.lastLoginAt = Instant.now();
    }

    /** Invalidates every previously issued token for this user. */
    public void bumpTokenVersion() {
        this.tokenVersion += 1;
    }

    public void setPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    public void setResetToken(String hashedToken, Instant expiresAt) {
        this.passwordResetToken = hashedToken;
        this.passwordResetTokenExpiresAt = expiresAt;
    }

    public void clearResetToken() {
        this.passwordResetToken = null;
        this.passwordResetTokenExpiresAt = null;
    }

    public void rename(String name) {
        this.name = name;
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }

    public void changeRole(Role role) {
        this.role = role;
    }

    public void activate() {
        this.isActive = true;
    }

    public void deactivate() {
        this.isActive = false;
        // Force sign-out everywhere the moment access is revoked.
        bumpTokenVersion();
    }

    // ── Accessors ─────────────────────────────────────────────────────────────

    public String getPharmacyId() { return pharmacyId; }

    public String getName() { return name; }

    public String getEmail() { return email; }

    public String getPhone() { return phone; }

    public String getPasswordHash() { return passwordHash; }

    public Role getRole() { return role; }

    public boolean isActive() { return isActive; }

    public Instant getLastLoginAt() { return lastLoginAt; }

    public int getTokenVersion() { return tokenVersion; }

    public Instant getPasswordResetTokenExpiresAt() { return passwordResetTokenExpiresAt; }

    public Pharmacy getPharmacy() { return pharmacy; }
}
