package com.checkup.pharmacy.modules.supplierreturn;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

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
}
