package com.checkup.pharmacy.modules.billing;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface SalesReturnRepository extends JpaRepository<SalesReturn, String> {

    @Query("SELECT r FROM SalesReturn r LEFT JOIN FETCH r.customer WHERE r.id = :id AND r.pharmacyId = :pharmacyId")
    Optional<SalesReturn> findByIdAndPharmacyId(@Param("id") String id, @Param("pharmacyId") String pharmacyId);

    Optional<SalesReturn> findByPharmacyIdAndIdempotencyKey(String pharmacyId, String idempotencyKey);

    List<SalesReturn> findByInvoiceId(String invoiceId);

    /** search cast to string — see InventoryRepository.search's javadoc for why a null bind value needs it. */
    @Query("""
            SELECT r FROM SalesReturn r LEFT JOIN FETCH r.customer
            WHERE r.pharmacyId = :pharmacyId
              AND (:invoiceId IS NULL OR r.invoiceId = :invoiceId)
              AND r.createdAt >= :from AND r.createdAt <= :to
              AND (:search IS NULL OR LOWER(r.returnNumber) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%')))
            ORDER BY r.createdAt DESC
            """)
    Page<SalesReturn> search(@Param("pharmacyId") String pharmacyId,
                             @Param("invoiceId") String invoiceId,
                             @Param("from") Instant from,
                             @Param("to") Instant to,
                             @Param("search") String search,
                             Pageable pageable);

    /** Sum of return values since a timestamp — powers the dashboard "today's returns" stat. */
    @Query("SELECT COALESCE(SUM(r.totalAmount), 0) FROM SalesReturn r WHERE r.pharmacyId = :pharmacyId AND r.createdAt >= :since")
    java.math.BigDecimal sumSince(@Param("pharmacyId") String pharmacyId, @Param("since") Instant since);
}
