package com.checkup.pharmacy.modules.doctor;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface DoctorRepository extends JpaRepository<Doctor, String> {

    /**
     * search is explicitly cast to string: a null :search bound into two OR'd
     * LOWER(CONCAT('%', :search, '%')) branches leaves Postgres unable to infer
     * the parameter's type ("function lower(bytea) does not exist") — see
     * InventoryRepository.search's javadoc for the full explanation.
     */
    @Query("""
            SELECT d FROM Doctor d
            WHERE d.pharmacyId = :pharmacyId
              AND (:search IS NULL
                   OR LOWER(d.name) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(d.specialty) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%')))
            """)
    Page<Doctor> search(@Param("pharmacyId") String pharmacyId,
                        @Param("search") String search,
                        Pageable pageable);

    Optional<Doctor> findByIdAndPharmacyId(String id, String pharmacyId);

    /**
     * Exact match only, deliberately not the name-OR-regNo fuzzy match {@link #search} and the
     * migration-import dedup finders use — this backs EMR prescription auto-capture, where a
     * name collision (two different "Dr. Sharma"s) linking to the wrong existing doctor is a
     * real risk. registrationNo is the only field trustworthy enough to auto-link on.
     */
    Optional<Doctor> findByPharmacyIdAndRegistrationNo(String pharmacyId, String registrationNo);

    long countByPharmacyId(String pharmacyId);

    /** Batched (pharmacyId, count) for a set of tenants — avoids an N+1 in platform views. */
    @Query("SELECT d.pharmacyId, COUNT(d) FROM Doctor d WHERE d.pharmacyId IN :ids GROUP BY d.pharmacyId")
    java.util.List<Object[]> countByPharmacyIdIn(@Param("ids") java.util.Collection<String> ids);

    /**
     * Batched counterpart of {@link #findMatchingForImport} — see the supplier repository's
     * note: the migration commit was issuing one SELECT per CSV row.
     */
    @Query("""
            SELECT d FROM Doctor d
            WHERE d.pharmacyId = :pharmacyId
              AND (LOWER(d.name) IN :lowerNames
                   OR (d.registrationNo IS NOT NULL AND d.registrationNo IN :registrationNos))
            """)
    java.util.List<Doctor> findMatchingForImportBatch(@Param("pharmacyId") String pharmacyId,
                                                      @Param("lowerNames") java.util.Collection<String> lowerNames,
                                                      @Param("registrationNos") java.util.Collection<String> registrationNos);

    /** Migration-import dedup: an existing doctor matches on EITHER registrationNo or name. */
    @Query("""
            SELECT d FROM Doctor d
            WHERE d.pharmacyId = :pharmacyId
              AND ((:registrationNo IS NOT NULL AND d.registrationNo = :registrationNo) OR LOWER(d.name) = LOWER(:name))
            """)
    java.util.List<Doctor> findMatchingForImport(@Param("pharmacyId") String pharmacyId, @Param("name") String name,
                                                 @Param("registrationNo") String registrationNo);
}
