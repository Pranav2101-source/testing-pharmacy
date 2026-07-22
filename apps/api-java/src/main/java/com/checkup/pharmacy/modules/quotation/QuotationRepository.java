package com.checkup.pharmacy.modules.quotation;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface QuotationRepository extends JpaRepository<Quotation, String> {

    @Query("SELECT q FROM Quotation q LEFT JOIN FETCH q.supplier WHERE q.id = :id AND q.pharmacyId = :pharmacyId")
    Optional<Quotation> findByIdAndPharmacyId(@Param("id") String id, @Param("pharmacyId") String pharmacyId);

    /**
     * Locking load for {@code convertToPo}, the third instance of this pattern after
     * GRN confirm and supplier-return confirm.
     *
     * <p>Conversion checks the quotation is RECEIVED and then creates a purchase
     * order. Unlocked that is a check-then-act: two concurrent conversions both see
     * RECEIVED and both raise a PO, so one quotation becomes two orders to the same
     * supplier for the same goods. An owner double-clicking Convert is enough — and
     * {@code DuplicateSubmitGuard} does not help here, since it is only applied to
     * create endpoints, never to state transitions.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT q FROM Quotation q WHERE q.id = :id AND q.pharmacyId = :pharmacyId")
    Optional<Quotation> lockByIdAndPharmacyId(@Param("id") String id, @Param("pharmacyId") String pharmacyId);

    /** status compared as text — see InventoryRepository.search's javadoc for why a null bind value needs it. */
    @Query("""
            SELECT q FROM Quotation q LEFT JOIN FETCH q.supplier
            WHERE q.pharmacyId = :pharmacyId
              AND (:supplierId IS NULL OR q.supplierId = :supplierId)
              AND (:status IS NULL OR CAST(q.status AS string) = :status)
              AND q.createdAt >= :from AND q.createdAt <= :to
            ORDER BY q.createdAt DESC
            """)
    Page<Quotation> search(@Param("pharmacyId") String pharmacyId,
                           @Param("supplierId") String supplierId,
                           @Param("status") String status,
                           @Param("from") Instant from,
                           @Param("to") Instant to,
                           Pageable pageable);

    @Query("SELECT q FROM Quotation q LEFT JOIN FETCH q.supplier WHERE q.id IN :ids AND q.pharmacyId = :pharmacyId")
    List<Quotation> findByIdInAndPharmacyId(@Param("ids") List<String> ids, @Param("pharmacyId") String pharmacyId);
}
