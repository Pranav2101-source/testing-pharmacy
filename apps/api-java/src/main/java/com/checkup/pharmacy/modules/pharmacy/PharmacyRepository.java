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

    /**
     * Resolves a pairing code by its indexed SHA-256 lookup hash — see
     * {@link com.checkup.pharmacy.modules.integration.emr.compat.ClinicPairingService} and
     * migration 20260823000002 for why this exists instead of decrypting every candidate.
     *
     * <p>Unscoped by {@code isActive} deliberately, mirroring {@link #findByEmrApiKey}: the
     * caller checks that (and decrypts nothing further — a hash match IS the verification,
     * the same trust level {@link com.checkup.pharmacy.security.ApiSecretHasher} already
     * carries for API-key authentication) after loading the row, not before, so an inactive
     * pharmacy's code fails for the same reason every other check does, not a different one.
     */
    java.util.Optional<Pharmacy> findByEmrSecretLookupHash(String emrSecretLookupHash);

    /**
     * The fallback population for pairing codes generated before {@code emrSecretLookupHash}
     * existed — every candidate here still has to be decrypted and compared the old way. This
     * set only shrinks: a pharmacy leaves it the moment its key is next rotated, from either
     * door ({@code EmrConnectionService#generateKey} or the platform-admin equivalent).
     */
    java.util.List<Pharmacy> findAllByEmrSecretLookupHashIsNullAndEmrSecretCiphertextIsNotNull();
}
