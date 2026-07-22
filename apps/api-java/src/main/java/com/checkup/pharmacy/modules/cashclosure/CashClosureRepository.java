package com.checkup.pharmacy.modules.cashclosure;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.Optional;

public interface CashClosureRepository extends JpaRepository<CashClosure, String> {

    Optional<CashClosure> findByIdAndPharmacyId(String id, String pharmacyId);

    Optional<CashClosure> findByPharmacyIdAndClosureDate(String pharmacyId, LocalDate closureDate);

    /**
     * status compared as text — see InventoryRepository.search's javadoc for why
     * a null bind value needs it. from/to are unconditional — the caller resolves
     * absent bounds via {@code common.util.DateRange}'s LocalDate overloads (same
     * rationale: Postgres must type-check every branch of the prepared statement,
     * including "IS NULL OR", so a genuinely null date parameter fails exactly
     * like the timestamp case).
     */
    @Query("""
            SELECT c FROM CashClosure c
            WHERE c.pharmacyId = :pharmacyId
              AND (:status IS NULL OR CAST(c.status AS string) = :status)
              AND c.closureDate >= :from AND c.closureDate <= :to
            ORDER BY c.closureDate DESC
            """)
    Page<CashClosure> search(@Param("pharmacyId") String pharmacyId,
                             @Param("status") String status,
                             @Param("from") LocalDate from,
                             @Param("to") LocalDate to,
                             Pageable pageable);
}
