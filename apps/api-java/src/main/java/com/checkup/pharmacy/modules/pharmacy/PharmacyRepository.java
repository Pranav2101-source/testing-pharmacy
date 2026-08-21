package com.checkup.pharmacy.modules.pharmacy;

import org.springframework.data.jpa.repository.JpaRepository;

public interface PharmacyRepository extends JpaRepository<Pharmacy, String> {

    boolean existsBySlug(String slug);

    /**
     * Ids only, for background jobs that sweep every tenant. Returning ids rather
     * than entities keeps a nightly sweep from pulling every pharmacy row into the
     * persistence context just to read a primary key.
     */
    @org.springframework.data.jpa.repository.Query("SELECT p.id FROM Pharmacy p WHERE p.isActive = true")
    java.util.List<String> findActivePharmacyIds();

    java.util.List<Pharmacy> findAllByOrderByNameAsc();

    long countByIsActiveTrue();

    java.util.List<Pharmacy> findTop3ByOrderByCreatedAtDesc();

    boolean existsByNameIgnoreCase(String name);

    /** Highest existing tenant code (TEN-######), for allocating the next one. */
    java.util.Optional<Pharmacy> findFirstByTenantCodeIsNotNullOrderByTenantCodeDesc();

    /**
     * Resolves the pharmacy a machine API key belongs to.
     *
     * <p>Deliberately unscoped, and necessarily so: this is authentication, which runs
     * <em>before</em> there is any tenant context to scope by — the same position
     * {@code AuthService}'s user lookup occupies for staff logins. The key IS the claim of
     * identity, and this is the lookup that decides whether to believe it.
     *
     * <p>Safe because the key is high-entropy and uniquely indexed, and because the caller
     * ({@link com.checkup.pharmacy.security.EmrApiKeyAuthenticationFilter}) still verifies
     * the secret half before trusting the row. Finding a pharmacy here grants nothing on
     * its own.
     */
    java.util.Optional<Pharmacy> findByEmrApiKey(String emrApiKey);
}
