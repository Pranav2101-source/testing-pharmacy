package com.checkup.pharmacy.modules.upload;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface UploadRepository extends JpaRepository<Upload, String> {

    long countByPharmacyId(String pharmacyId);

    Optional<Upload> findByIdAndPharmacyId(String id, String pharmacyId);

    /**
     * Bulk, tenant-scoped counterpart of {@link #findByIdAndPharmacyId}.
     *
     * <p>For resolving the scan attached to each row of a prescriptions page in one
     * query instead of one per row. Scoped by pharmacyId rather than trusting the ids,
     * for the same reason every other batch finder here is — see
     * UnscopedFinderCallGuardTest, which rejects a bare {@code findAllById} on a
     * tenant-owned entity.
     */
    java.util.List<Upload> findByIdInAndPharmacyId(java.util.Collection<String> ids, String pharmacyId);
}
