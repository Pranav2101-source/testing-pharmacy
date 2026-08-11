package com.checkup.pharmacy.modules.prescription;

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
}
