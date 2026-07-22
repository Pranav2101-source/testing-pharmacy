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
}
