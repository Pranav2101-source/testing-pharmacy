package com.checkup.pharmacy.modules.supplierledger;

import com.checkup.pharmacy.common.projection.SupplierAmountRow;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface SupplierLedgerEntryRepository extends JpaRepository<SupplierLedgerEntry, String> {

    @Query("""
            SELECT e FROM SupplierLedgerEntry e LEFT JOIN FETCH e.supplier
            WHERE e.id = :id AND e.pharmacyId = :pharmacyId
              AND CAST(e.type AS string) = 'PAYMENT'
            """)
    Optional<SupplierLedgerEntry> findPaymentByIdAndPharmacyId(@Param("id") String id, @Param("pharmacyId") String pharmacyId);

    @Query("""
            SELECT e FROM SupplierLedgerEntry e LEFT JOIN FETCH e.supplier
            WHERE e.id = :id AND e.pharmacyId = :pharmacyId
              AND CAST(e.type AS string) = 'CREDIT_NOTE'
            """)
    Optional<SupplierLedgerEntry> findCreditNoteByIdAndPharmacyId(@Param("id") String id, @Param("pharmacyId") String pharmacyId);

    /**
     * Locking load for {@code updateStatus} — marking a standalone credit note
     * APPLIED calls {@link com.checkup.pharmacy.modules.supplier.Supplier#adjustLedgerBalance},
     * a check-then-act (only PENDING may transition) that needs a row lock to stay
     * race-free, same reasoning as {@code SupplierReturnRepository.lockByIdAndPharmacyId}.
     * No fetch-join here: Postgres rejects {@code FOR UPDATE} on the nullable side of
     * an outer join, so the supplier is loaded separately where the caller needs it.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            SELECT e FROM SupplierLedgerEntry e
            WHERE e.id = :id AND e.pharmacyId = :pharmacyId
              AND CAST(e.type AS string) = 'CREDIT_NOTE'
            """)
    Optional<SupplierLedgerEntry> lockCreditNoteByIdAndPharmacyId(@Param("id") String id, @Param("pharmacyId") String pharmacyId);

    @Query("""
            SELECT e FROM SupplierLedgerEntry e LEFT JOIN FETCH e.supplier
            WHERE e.pharmacyId = :pharmacyId AND CAST(e.type AS string) = 'PAYMENT'
              AND (:supplierId IS NULL OR e.supplierId = :supplierId)
              AND (:grnId IS NULL OR e.grnId = :grnId)
              AND e.paidAt >= :from AND e.paidAt <= :to
            ORDER BY e.paidAt DESC
            """)
    Page<SupplierLedgerEntry> searchPayments(@Param("pharmacyId") String pharmacyId,
                                             @Param("supplierId") String supplierId,
                                             @Param("grnId") String grnId,
                                             @Param("from") Instant from,
                                             @Param("to") Instant to,
                                             Pageable pageable);

    /** status compared as text — see InventoryRepository.search for the null-enum-parameter rationale. */
    @Query("""
            SELECT e FROM SupplierLedgerEntry e LEFT JOIN FETCH e.supplier
            WHERE e.pharmacyId = :pharmacyId AND CAST(e.type AS string) = 'CREDIT_NOTE'
              AND (:supplierId IS NULL OR e.supplierId = :supplierId)
              AND (:status IS NULL OR CAST(e.status AS string) = :status)
              AND e.issuedAt >= :from AND e.issuedAt <= :to
            ORDER BY e.issuedAt DESC
            """)
    Page<SupplierLedgerEntry> searchCreditNotes(@Param("pharmacyId") String pharmacyId,
                                                @Param("supplierId") String supplierId,
                                                @Param("status") String status,
                                                @Param("from") Instant from,
                                                @Param("to") Instant to,
                                                Pageable pageable);

    @Query("""
            SELECT COALESCE(SUM(e.amount), 0) FROM SupplierLedgerEntry e
            WHERE e.pharmacyId = :pharmacyId AND e.supplierId = :supplierId
              AND CAST(e.type AS string) = 'PAYMENT'
            """)
    BigDecimal sumPaymentsForSupplier(@Param("pharmacyId") String pharmacyId, @Param("supplierId") String supplierId);

    @Query("""
            SELECT e.supplierId AS supplierId, COALESCE(SUM(e.amount), 0) AS total FROM SupplierLedgerEntry e
            WHERE e.pharmacyId = :pharmacyId AND CAST(e.type AS string) = 'PAYMENT'
            GROUP BY e.supplierId
            """)
    List<SupplierAmountRow> sumPaymentsBySupplier(@Param("pharmacyId") String pharmacyId);

    @Query("""
            SELECT COALESCE(SUM(e.amount), 0) FROM SupplierLedgerEntry e
            WHERE e.pharmacyId = :pharmacyId AND CAST(e.type AS string) = 'CREDIT_NOTE'
              AND CAST(e.status AS string) = 'PENDING'
            """)
    BigDecimal sumPendingCreditNotes(@Param("pharmacyId") String pharmacyId);
}
