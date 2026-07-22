package com.checkup.pharmacy.modules.supplier;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface SupplierRepository extends JpaRepository<Supplier, String> {

    @Query("""
            SELECT s FROM Supplier s
            WHERE s.pharmacyId = :pharmacyId
              AND (:search IS NULL OR LOWER(s.name) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%')))
              AND (:isActive IS NULL OR s.isActive = :isActive)
            """)
    Page<Supplier> search(@Param("pharmacyId") String pharmacyId,
                          @Param("search") String search,
                          @Param("isActive") Boolean isActive,
                          Pageable pageable);

    Optional<Supplier> findByIdAndPharmacyId(String id, String pharmacyId);

    /**
     * Locking load for any path that calls {@link Supplier#adjustLedgerBalance}.
     *
     * <p>That method is a read-modify-write on a running total, and THREE unrelated
     * flows call it: confirming a GRN (increases what is owed), recording a payment,
     * and confirming a supplier return (both decrease it). Each of those already locks
     * its own DOCUMENT, which stops the same document being applied twice — but two
     * DIFFERENT documents for the same supplier still raced. Both read the old
     * balance, both wrote, and one adjustment vanished.
     *
     * <p>The failure is silent and cumulative: no error, no log, just a supplier
     * balance that drifts away from the sum of its ledger entries. It is the figure
     * the pharmacy pays against, so the drift is money.
     *
     * <p>Pessimistic rather than optimistic because there is no {@code @Version}
     * column anywhere in this schema, and adding one is a Prisma migration. Callers
     * take this AFTER their document lock, so lock ordering stays document-then-
     * supplier everywhere and cannot cycle.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM Supplier s WHERE s.id = :id AND s.pharmacyId = :pharmacyId")
    Optional<Supplier> lockByIdAndPharmacyId(@Param("id") String id, @Param("pharmacyId") String pharmacyId);

    List<Supplier> findByPharmacyId(String pharmacyId);

    /** Unpaginated, active-only — powers simple picker dropdowns (e.g. quotation creation). */
    @Query("SELECT s FROM Supplier s WHERE s.pharmacyId = :pharmacyId AND s.isActive = true ORDER BY s.name ASC")
    List<Supplier> findAllActiveByPharmacyId(@Param("pharmacyId") String pharmacyId);

    /** Migration-import dedup: an existing supplier matches on EITHER name or gstin, not just one. */
    @Query("""
            SELECT s FROM Supplier s
            WHERE s.pharmacyId = :pharmacyId
              AND (LOWER(s.name) = LOWER(:name) OR (:gstin IS NOT NULL AND s.gstin = :gstin))
            """)
    List<Supplier> findMatchingForImport(@Param("pharmacyId") String pharmacyId, @Param("name") String name,
                                         @Param("gstin") String gstin);
}
