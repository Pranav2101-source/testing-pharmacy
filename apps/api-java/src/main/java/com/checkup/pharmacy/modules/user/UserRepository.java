package com.checkup.pharmacy.modules.user;

import com.checkup.pharmacy.common.enums.Role;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, String> {

    /**
     * Revocation check for the auth filter — see {@link AuthStatus} for why this
     * is a projection rather than {@code findById}.
     *
     * <p>Not pharmacy-scoped by design: it runs before the SecurityContext exists,
     * so there is no tenant yet. The id comes from an already signature-verified
     * JWT subject, and only two non-sensitive booleans/ints are returned.
     *
     * <p><b>{@code @Transactional} is required, not decorative.</b> Spring Data
     * applies its class-level transaction attributes to the inherited CRUD methods
     * ({@code findById} and friends) but NOT to custom {@code @Query} methods
     * declared here. Without it this runs with no transaction, so
     * {@code RlsTenantTransactionManager} never begins one and never sets
     * {@code app.pharmacy_id} — Row-Level Security then fails the read closed, it
     * returns no row, and every authenticated request in the application 401s.
     * That is exactly what happened the first time this was written.
     *
     * <p>General rule this illustrates: under RLS, a repository method invoked
     * outside any service transaction will see nothing. Almost all calls here are
     * made from {@code @Transactional} services, which is why this filter — which
     * runs before them — is the one place it bites.
     */
    @Transactional(readOnly = true)
    @Query("SELECT new com.checkup.pharmacy.modules.user.AuthStatus(u.isActive, u.tokenVersion) "
           + "FROM User u WHERE u.id = :id")
    Optional<AuthStatus> findAuthStatusById(@Param("id") String id);

    /**
     * Case/whitespace-insensitive by design: {@code User.email} is stored
     * normalized (trim + lower-case, see {@link User#create}) but every caller
     * here — login, forgotPassword — passes through whatever a person actually
     * typed, so the comparison itself must not depend on either side already
     * being canonical.
     */
    @Query("SELECT u FROM User u WHERE LOWER(TRIM(u.email)) = LOWER(TRIM(CAST(:email AS string)))")
    Optional<User> findByEmail(@Param("email") String email);

    /** See {@link #findByEmail} — same case/whitespace-insensitive comparison, for pre-create duplicate checks. */
    @Query("SELECT COUNT(u) > 0 FROM User u WHERE LOWER(TRIM(u.email)) = LOWER(TRIM(CAST(:email AS string)))")
    boolean existsByEmail(@Param("email") String email);

    Optional<User> findByPasswordResetToken(String passwordResetToken);

    List<User> findByPharmacyIdOrderByCreatedAtAsc(String pharmacyId);

    /** Tenant-scoped lookup — prevents one pharmacy from reaching another's user by id. */
    Optional<User> findByIdAndPharmacyId(String id, String pharmacyId);

    long countByPharmacyIdAndRoleAndIsActive(String pharmacyId, Role role, boolean isActive);

    /** The tenant's owner (first, if somehow more than one) — used by platform tenant views. */
    Optional<User> findFirstByPharmacyIdAndRole(String pharmacyId, Role role);

    /** Total staff (all users) for one tenant — the subscription "staff" usage numerator. */
    long countByPharmacyId(String pharmacyId);

    /** Batched (pharmacyId, count) of users across tenants — avoids an N+1 in platform views. */
    @Query("SELECT u.pharmacyId, COUNT(u) FROM User u WHERE u.pharmacyId IN :ids GROUP BY u.pharmacyId")
    List<Object[]> countByPharmacyIdIn(@Param("ids") Collection<String> ids);

    /** Batched owner lookup for a page of tenants — avoids an N+1 across pharmacies. */
    List<User> findByPharmacyIdInAndRole(Collection<String> pharmacyIds, Role role);

    /** Revoke every session for one tenant (suspend/archive/expire) by bumping token versions. */
    @Modifying
    @Query("UPDATE User u SET u.tokenVersion = u.tokenVersion + 1 WHERE u.pharmacyId = :pharmacyId")
    int bumpTokenVersionByPharmacyId(@Param("pharmacyId") String pharmacyId);

    /** Revoke sessions across a batch of tenants (bulk suspend/archive). */
    @Modifying
    @Query("UPDATE User u SET u.tokenVersion = u.tokenVersion + 1 WHERE u.pharmacyId IN :pharmacyIds")
    int bumpTokenVersionByPharmacyIds(@Param("pharmacyIds") Collection<String> pharmacyIds);
}
