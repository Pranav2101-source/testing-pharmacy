package com.checkup.pharmacy.modules.supplierreturn;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;

public interface SupplierReturnRepository extends JpaRepository<SupplierReturn, String> {

    @Query("SELECT r FROM SupplierReturn r LEFT JOIN FETCH r.supplier WHERE r.id = :id AND r.pharmacyId = :pharmacyId")
    Optional<SupplierReturn> findByIdAndPharmacyId(@Param("id") String id, @Param("pharmacyId") String pharmacyId);

    /**
     * Locking load for {@code confirm}, mirroring
     * {@code GoodsReceiptNoteRepository.lockByIdAndPharmacyId}.
     *
     * <p>Confirming a supplier return DEDUCTS stock and credits the supplier ledger.
     * The DRAFT check that guards it is a check-then-act: without a row lock, two
     * concurrent confirmations both read DRAFT and both apply, sending the goods back
     * twice on paper and taking the stock out twice.
     *
     * <p>No {@code JOIN FETCH} — Postgres rejects {@code FOR UPDATE} on the nullable
     * side of an outer join.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM SupplierReturn r WHERE r.id = :id AND r.pharmacyId = :pharmacyId")
    Optional<SupplierReturn> lockByIdAndPharmacyId(@Param("id") String id, @Param("pharmacyId") String pharmacyId);

    /** status compared as text — see InventoryRepository.search for the null-enum-parameter rationale. */
    @Query("""
            SELECT r FROM SupplierReturn r LEFT JOIN FETCH r.supplier
            WHERE r.pharmacyId = :pharmacyId
              AND (:status IS NULL OR CAST(r.status AS string) = :status)
              AND (:supplierId IS NULL OR r.supplierId = :supplierId)
              AND r.createdAt >= :from AND r.createdAt <= :to
            ORDER BY r.createdAt DESC
            """)
    Page<SupplierReturn> search(@Param("pharmacyId") String pharmacyId,
                                @Param("status") String status,
                                @Param("supplierId") String supplierId,
                                @Param("from") Instant from,
                                @Param("to") Instant to,
                                Pageable pageable);

    interface ItcReversalRow {
        BigDecimal getIgst();
        BigDecimal getCgst();
        BigDecimal getSgst();
    }

    /**
     * Input tax credit to reverse in Table 4(B) — the debit notes CONFIRMED on suppliers in
     * the period.
     *
     * <p>Stock sent back is stock the pharmacy no longer holds, so the credit claimed when it
     * arrived has to come back out. Omitting this leaves the return over-claiming ITC by the
     * whole value of every rejection, expiry return and short-supply adjustment in the month.
     *
     * <p>CONFIRMED ONLY, and this is not a detail. A supplier return computes and STORES its
     * cgst/sgst/igst at creation time, then sits in DRAFT until someone confirms it — and
     * {@code cancel()} only flips the status, leaving those tax columns populated. Without the
     * status filter this query reversed credit for goods that never left the building and for
     * debit notes that were explicitly abandoned, understating Table 4(C) net ITC and making
     * the pharmacy pay the difference in cash.
     *
     * <p>Mirrors {@code GRNItemRepository.inwardSuppliesByTaxability} deliberately: that query
     * claims credit on CONFIRMED receipts keyed on {@code confirmedAt}, and a reversal has to
     * be filtered and dated the same way or the two halves of Table 4 describe different sets
     * of events. Keyed on {@code createdAt}, a return drafted on 30 March and confirmed on
     * 5 April reversed in March a credit that was claimed in April.
     *
     * <p>{@code confirmedAt} is null for anything not confirmed, so the status test and the
     * date test agree by construction rather than by coincidence.
     */
    @Query("""
            SELECT COALESCE(SUM(r.igst), 0) AS igst,
                   COALESCE(SUM(r.cgst), 0) AS cgst,
                   COALESCE(SUM(r.sgst), 0) AS sgst
            FROM SupplierReturn r
            WHERE r.pharmacyId = :pharmacyId
              AND CAST(r.status AS string) = 'CONFIRMED'
              AND r.confirmedAt IS NOT NULL
              AND r.confirmedAt >= :from AND r.confirmedAt <= :to
            """)
    ItcReversalRow itcReversedInRange(@Param("pharmacyId") String pharmacyId,
                                      @Param("from") Instant from, @Param("to") Instant to);
}
