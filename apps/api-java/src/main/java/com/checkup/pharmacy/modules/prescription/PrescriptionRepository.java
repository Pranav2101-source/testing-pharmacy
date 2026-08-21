package com.checkup.pharmacy.modules.prescription;

import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;

public interface PrescriptionRepository extends JpaRepository<Prescription, String> {

    long countByPharmacyId(String pharmacyId);

    /** Rollback guard: how many prescriptions name one of these doctors. */
    long countByPharmacyIdAndDoctorIdIn(String pharmacyId, java.util.Collection<String> doctorIds);

    Optional<Prescription> findByIdAndPharmacyId(String id, String pharmacyId);

    Optional<Prescription> findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
            String pharmacyId, String externalEmrTenantId, String externalEmrPrescriptionId);

    /** Integrations screen: how many prescriptions arrived from a clinic rather than the till. */
    long countByPharmacyIdAndExternalEmrPrescriptionIdIsNotNull(String pharmacyId);

    /** Nav badge: clinic-sourced prescriptions no pharmacist has opened yet. */
    long countByPharmacyIdAndExternalEmrPrescriptionIdIsNotNullAndViewedAtIsNull(String pharmacyId);

    /** Integrations screen: dispensing updates in one delivery state (PENDING / SENT / FAILED). */
    long countByPharmacyIdAndDispenseNotifyStatus(String pharmacyId, String dispenseNotifyStatus);

    @Query("""
            SELECT MAX(rx.createdAt) FROM Prescription rx
            WHERE rx.pharmacyId = :pharmacyId AND rx.externalEmrPrescriptionId IS NOT NULL
            """)
    Instant findLastEmrPrescriptionAt(@Param("pharmacyId") String pharmacyId);

    /**
     * status compared as text, search cast explicitly — see
     * InventoryRepository.search's javadoc for why a null bind value needs both.
     * from/to are unconditional; caller resolves absent bounds via {@code DateRange}.
     */
    @Query("""
            SELECT rx FROM Prescription rx
            LEFT JOIN FETCH rx.doctor
            WHERE rx.pharmacyId = :pharmacyId
              AND (:status IS NULL OR CAST(rx.status AS string) = :status)
              AND (:doctorId IS NULL OR rx.doctorId = :doctorId)
              AND rx.createdAt >= :from AND rx.createdAt <= :to
              AND (:search IS NULL
                   OR LOWER(rx.patientName) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(rx.doctorName) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(rx.prescriptionNumber) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%')))
            ORDER BY rx.createdAt DESC
            """)
    Page<Prescription> search(@Param("pharmacyId") String pharmacyId,
                              @Param("status") String status,
                              @Param("doctorId") String doctorId,
                              @Param("from") Instant from,
                              @Param("to") Instant to,
                              @Param("search") String search,
                              Pageable pageable);

    /**
     * The dispense-callback backlog: prescriptions owed a delivery and due for one.
     *
     * <p>Deliberately NOT scoped by pharmacy, and exempted in the tenant guard below. The
     * sweeper runs on a schedule with no tenant and its whole job is to work across every
     * pharmacy at once; scoping it per tenant would mean a query per pharmacy every tick,
     * growing with signups rather than with integrations.
     *
     * <p>The predicate matches the partial index from migration 20260819000003 exactly —
     * status IN (PENDING, FAILED) AND due — so the sweep reads the backlog rather than the
     * table. Rows with nothing scheduled (delivered, or given up on) hold NULL and are
     * excluded by the comparison.
     */
    @Query("""
            SELECT rx FROM Prescription rx
            WHERE rx.dispenseNotifyStatus IN ('PENDING', 'FAILED')
              AND rx.dispenseNotifyNextAttemptAt IS NOT NULL
              AND rx.dispenseNotifyNextAttemptAt <= :now
              AND rx.dispenseNotifyAttempts < :maxAttempts
            ORDER BY rx.dispenseNotifyNextAttemptAt
            """)
    List<Prescription> findDispenseCallbackBacklog(@Param("now") Instant now,
                                                   @Param("maxAttempts") int maxAttempts,
                                                   Pageable pageable);
}
