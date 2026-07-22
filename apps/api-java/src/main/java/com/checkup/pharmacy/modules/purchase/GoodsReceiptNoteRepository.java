package com.checkup.pharmacy.modules.purchase;

import com.checkup.pharmacy.common.projection.SupplierAmountRow;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface GoodsReceiptNoteRepository extends JpaRepository<GoodsReceiptNote, String> {

    @Query("SELECT g FROM GoodsReceiptNote g LEFT JOIN FETCH g.supplier WHERE g.id = :id AND g.pharmacyId = :pharmacyId")
    Optional<GoodsReceiptNote> findByIdAndPharmacyId(@Param("id") String id, @Param("pharmacyId") String pharmacyId);

    /**
     * Locking load for {@code confirmGrn}, whose DRAFT check is otherwise a
     * check-then-act with no lock holding it together.
     *
     * <p>Confirming a GRN is the moment purchased stock enters inventory and the
     * supplier ledger is debited. Two staff confirming the same GRN at once both read
     * DRAFT, both pass the guard, and both apply — receiving the delivery twice into
     * stock and billing the supplier twice. Taking the row lock here makes the second
     * caller wait, re-read CONFIRMED, and fail cleanly with "Only DRAFT GRNs can be
     * confirmed".
     *
     * <p>No {@code JOIN FETCH}: Postgres rejects {@code FOR UPDATE} on the nullable
     * side of an outer join. confirmGrn loads the supplier separately anyway.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT g FROM GoodsReceiptNote g WHERE g.id = :id AND g.pharmacyId = :pharmacyId")
    Optional<GoodsReceiptNote> lockByIdAndPharmacyId(@Param("id") String id, @Param("pharmacyId") String pharmacyId);

    /** Duplicate-invoice guard: is this supplier invoice number already saved (excluding cancelled GRNs)? */
    @Query("""
            SELECT g FROM GoodsReceiptNote g
            WHERE g.pharmacyId = :pharmacyId AND g.supplierId = :supplierId
              AND g.supplierInvoiceNo = :supplierInvoiceNo
              AND CAST(g.status AS string) <> 'CANCELLED'
              AND (:excludeId IS NULL OR g.id <> :excludeId)
            """)
    List<GoodsReceiptNote> findDuplicateInvoice(@Param("pharmacyId") String pharmacyId,
                                                @Param("supplierId") String supplierId,
                                                @Param("supplierInvoiceNo") String supplierInvoiceNo,
                                                @Param("excludeId") String excludeId);

    @Query("""
            SELECT g FROM GoodsReceiptNote g LEFT JOIN FETCH g.supplier
            WHERE g.pharmacyId = :pharmacyId
              AND (:status IS NULL OR CAST(g.status AS string) = :status)
              AND (:supplierId IS NULL OR g.supplierId = :supplierId)
              AND (:overdue = false OR (g.paymentDueDate < :now AND CAST(g.status AS string) = 'CONFIRMED'))
              AND g.createdAt >= :from AND g.createdAt <= :to
            ORDER BY g.createdAt DESC
            """)
    Page<GoodsReceiptNote> search(@Param("pharmacyId") String pharmacyId,
                                  @Param("status") String status,
                                  @Param("supplierId") String supplierId,
                                  @Param("overdue") boolean overdue,
                                  @Param("now") Instant now,
                                  @Param("from") Instant from,
                                  @Param("to") Instant to,
                                  Pageable pageable);

    List<GoodsReceiptNote> findByPurchaseOrderIdAndStatus(String purchaseOrderId, com.checkup.pharmacy.common.enums.GRNStatus status);

    List<GoodsReceiptNote> findByPurchaseOrderId(String purchaseOrderId);

    @Query("""
            SELECT COALESCE(SUM(g.totalAmount), 0) FROM GoodsReceiptNote g
            WHERE g.pharmacyId = :pharmacyId AND g.supplierId = :supplierId
              AND CAST(g.status AS string) = 'CONFIRMED'
            """)
    BigDecimal sumConfirmedForSupplier(@Param("pharmacyId") String pharmacyId, @Param("supplierId") String supplierId);

    @Query("""
            SELECT g.supplierId AS supplierId, COALESCE(SUM(g.totalAmount), 0) AS total FROM GoodsReceiptNote g
            WHERE g.pharmacyId = :pharmacyId AND CAST(g.status AS string) = 'CONFIRMED'
            GROUP BY g.supplierId
            """)
    List<SupplierAmountRow> sumConfirmedBySupplier(
            @Param("pharmacyId") String pharmacyId);

    @Query("""
            SELECT g.supplierId AS supplierId, COALESCE(SUM(g.totalAmount), 0) AS total FROM GoodsReceiptNote g
            WHERE g.pharmacyId = :pharmacyId AND CAST(g.status AS string) = 'CONFIRMED'
              AND g.paymentDueDate < :now
            GROUP BY g.supplierId
            """)
    List<SupplierAmountRow> sumOverdueBySupplier(
            @Param("pharmacyId") String pharmacyId, @Param("now") Instant now);

    @Query("""
            SELECT g FROM GoodsReceiptNote g
            WHERE g.pharmacyId = :pharmacyId AND g.supplierId = :supplierId
              AND CAST(g.status AS string) = 'CONFIRMED' AND g.paymentDueDate < :now
            ORDER BY g.paymentDueDate ASC
            """)
    List<GoodsReceiptNote> findOverdueForSupplier(@Param("pharmacyId") String pharmacyId,
                                                  @Param("supplierId") String supplierId, @Param("now") Instant now);

    // ── Reporting ──────────────────────────────────────────────────────────────

    @Query("""
            SELECT g.id FROM GoodsReceiptNote g
            WHERE g.pharmacyId = :pharmacyId AND CAST(g.status AS string) = 'CONFIRMED'
              AND g.confirmedAt >= :from AND g.confirmedAt <= :to
            """)
    List<String> findConfirmedIdsInRange(@Param("pharmacyId") String pharmacyId,
                                         @Param("from") Instant from, @Param("to") Instant to);

    @Query("""
            SELECT COALESCE(SUM(g.totalAmount), 0) AS total, COALESCE(SUM(g.totalGst), 0) AS gst,
                   COALESCE(SUM(g.subtotal), 0) AS subtotal, COUNT(g) AS cnt
            FROM GoodsReceiptNote g
            WHERE g.pharmacyId = :pharmacyId AND CAST(g.status AS string) = 'CONFIRMED'
              AND g.confirmedAt >= :from AND g.confirmedAt <= :to
            """)
    GrnSpendAggregateRow sumConfirmedInRange(@Param("pharmacyId") String pharmacyId,
                                             @Param("from") Instant from, @Param("to") Instant to);

    interface GrnSpendAggregateRow {
        BigDecimal getTotal();
        BigDecimal getGst();
        BigDecimal getSubtotal();
        long getCnt();
    }

    @Query("""
            SELECT COUNT(g) FROM GoodsReceiptNote g
            WHERE g.pharmacyId = :pharmacyId AND CAST(g.status AS string) = 'CONFIRMED' AND g.paymentDueDate < :now
            """)
    long countOverdue(@Param("pharmacyId") String pharmacyId, @Param("now") Instant now);

    long countByPharmacyIdAndStatus(String pharmacyId, com.checkup.pharmacy.common.enums.GRNStatus status);
}
