package com.checkup.pharmacy.modules.inventory;

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

public interface InventoryRepository extends JpaRepository<Inventory, String> {

    Optional<Inventory> findByIdAndPharmacyId(String id, String pharmacyId);

    /**
     * Loads the given batches and holds a write lock on each for the rest of the
     * transaction (Postgres {@code SELECT ... FOR UPDATE}).
     *
     * <p>This is the alternative to running the whole sale under SERIALIZABLE.
     * Serializable isolation asks Postgres to detect, after the fact, that two
     * transactions could not have been ordered — which under load means both
     * counters do all their work and one is then told to throw it away. Taking
     * the row locks up front makes the second counter wait a few milliseconds for
     * the specific batches it needs, then proceed. Contention is narrowed from
     * "the entire transaction's read set" to "these batch rows".
     *
     * <p><b>ORDER BY id is load-bearing, not cosmetic.</b> Two invoices touching
     * the same two batches in opposite orders deadlock. Acquiring locks in a
     * single globally consistent order (ascending id) means one waits instead.
     * Postgres does not contractually guarantee lock order matches ORDER BY under
     * every plan, so {@link com.checkup.pharmacy.common.concurrency.RetryOnConflict}
     * still backstops the residual case rather than relying on ordering alone.
     *
     * <p>Deliberately no {@code JOIN FETCH}: Postgres rejects {@code FOR UPDATE}
     * applied to the nullable side of an outer join. Callers touch
     * {@code getMedicine()} inside the same transaction, so it resolves lazily.
     *
     * <p>pharmacyId is a parameter rather than being derived inside the query so
     * this cannot become another un-scoped lookup — see TenantIsolationGuardTest.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT i FROM Inventory i WHERE i.id IN :ids AND i.pharmacyId = :pharmacyId ORDER BY i.id")
    List<Inventory> lockAllByIdInAndPharmacyId(@Param("ids") java.util.Collection<String> ids,
                                               @Param("pharmacyId") String pharmacyId);

    /**
     * Tenant-scoped bulk lookup by id, WITHOUT taking write locks.
     *
     * <p>For paths that mutate batches already established as belonging to the caller
     * — restoring stock on an invoice cancellation or sales return, releasing a
     * session's reservations — where the plain {@code findAllById} they previously
     * used carried no pharmacyId predicate at all.
     *
     * <p>Use {@link #lockAllByIdInAndPharmacyId} instead when the read-then-write race
     * matters (selling, reserving). This one is for writes whose input ids were
     * themselves loaded tenant-scoped, and exists so tenancy does not depend on that
     * remaining true after some future refactor.
     */
    List<Inventory> findByIdInAndPharmacyId(java.util.Collection<String> ids, String pharmacyId);

    Optional<Inventory> findByPharmacyIdAndMedicineIdAndBatchNumber(String pharmacyId, String medicineId, String batchNumber);

    List<Inventory> findByPharmacyIdAndMedicineIdIn(String pharmacyId, java.util.Collection<String> medicineIds);

    List<Inventory> findByPharmacyIdAndStatus(String pharmacyId, com.checkup.pharmacy.common.enums.BatchStatus status);

    /**
     * status is compared as text — binding a null value typed as the Postgres
     * custom enum fails with "could not determine data type of parameter"
     * (SQLState 42P18); casting both sides to text sidesteps it (see
     * CustomerRepository for the same fix).
     *
     * search is explicitly cast to string too: a null :search bound into three
     * OR'd LOWER(CONCAT('%', :search, '%')) branches leaves Postgres unable to
     * resolve the parameter's type from context (it infers bytea and then
     * "function lower(bytea) does not exist") — the same class of bug as the
     * enum one, just a different error shape. The CAST forces text unconditionally.
     */
    @Query("""
            SELECT i FROM Inventory i
            WHERE i.pharmacyId = :pharmacyId
              AND (:search IS NULL
                   OR LOWER(i.medicine.name) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(i.medicine.genericName) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(i.batchNumber) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%')))
              AND (:medicineId IS NULL OR i.medicineId = :medicineId)
              AND (:inStock = false OR i.quantity > 0)
              AND (:nearExpiry = false OR i.expiryDate <= :nearExpiryThreshold)
              AND (:status IS NULL OR CAST(i.status AS string) = :status)
              AND (:lowStock = false OR (i.quantity > 0 AND i.quantity <= i.minimumStock))
            """)
    Page<Inventory> search(@Param("pharmacyId") String pharmacyId,
                           @Param("search") String search,
                           @Param("medicineId") String medicineId,
                           @Param("inStock") boolean inStock,
                           @Param("nearExpiry") boolean nearExpiry,
                           @Param("nearExpiryThreshold") Instant nearExpiryThreshold,
                           @Param("status") String status,
                           @Param("lowStock") boolean lowStock,
                           Pageable pageable);

    @Query("""
            SELECT COUNT(i) FROM Inventory i
            WHERE i.pharmacyId = :pharmacyId AND i.expiryDate <= :threshold AND i.quantity > 0
              AND CAST(i.status AS string) IN ('ACTIVE', 'EXPIRED')
            """)
    long countExpiryAlerts(@Param("pharmacyId") String pharmacyId, @Param("threshold") Instant threshold);

    @Query("""
            SELECT COUNT(i) FROM Inventory i
            WHERE i.pharmacyId = :pharmacyId AND CAST(i.status AS string) = 'ACTIVE'
              AND i.quantity <= i.minimumStock
            """)
    long countLowStockAlerts(@Param("pharmacyId") String pharmacyId);

    /** Dashboard low-stock count — ACTIVE, in-stock (quantity &gt; 0), at/below minimum (matches the old Node stat exactly). */
    @Query("""
            SELECT COUNT(i) FROM Inventory i
            WHERE i.pharmacyId = :pharmacyId AND CAST(i.status AS string) = 'ACTIVE'
              AND i.quantity > 0 AND i.quantity <= i.minimumStock
            """)
    long countLowStockInStock(@Param("pharmacyId") String pharmacyId);

    /**
     * Batches at or near expiry, soonest first.
     *
     * <p>Takes a {@link org.springframework.data.domain.Pageable} so the bound is
     * applied in SQL. It previously returned every matching row and callers trimmed
     * the result in Java — {@code ReportsService} even accepted a {@code limit}
     * parameter and then applied it with {@code .stream().limit(n)}, which reads
     * like a bound but is not one: the database still returned, transferred, and
     * materialised every row before Java discarded most of them.
     *
     * <p>Truncating here is safe precisely because of the ORDER BY: the rows that
     * survive the cut are the ones expiring soonest, which are the ones that matter.
     * A tail that is cut off is stock with the most time left.
     */
    @Query("""
            SELECT i FROM Inventory i LEFT JOIN FETCH i.medicine
            WHERE i.pharmacyId = :pharmacyId AND i.expiryDate <= :threshold AND i.quantity > 0
              AND CAST(i.status AS string) IN ('ACTIVE', 'EXPIRED')
            ORDER BY i.expiryDate ASC
            """)
    List<Inventory> findExpiryAlerts(@Param("pharmacyId") String pharmacyId,
                                     @Param("threshold") Instant threshold,
                                     org.springframework.data.domain.Pageable pageable);

    /** Bounded in SQL, lowest stock first — see {@link #findExpiryAlerts} for why. */
    @Query("""
            SELECT i FROM Inventory i
            WHERE i.pharmacyId = :pharmacyId AND CAST(i.status AS string) = 'ACTIVE'
              AND i.quantity <= i.minimumStock
            ORDER BY i.quantity ASC
            """)
    List<Inventory> findLowStockAlerts(@Param("pharmacyId") String pharmacyId,
                                       org.springframework.data.domain.Pageable pageable);

    /** FEFO — first-expiry-first-out. Only a batch with enough unreserved stock is eligible. */
    @Query("""
            SELECT i FROM Inventory i
            WHERE i.pharmacyId = :pharmacyId AND i.medicineId = :medicineId
              AND CAST(i.status AS string) = 'ACTIVE'
              AND i.expiryDate > :now
              AND (i.quantity - i.reservedQuantity) >= :quantity
            ORDER BY i.expiryDate ASC
            """)
    List<Inventory> findFefoCandidates(@Param("pharmacyId") String pharmacyId,
                                       @Param("medicineId") String medicineId,
                                       @Param("now") Instant now,
                                       @Param("quantity") int quantity,
                                       org.springframework.data.domain.Pageable limit);

    List<Inventory> findByPharmacyIdAndBatchNumberAndStatus(String pharmacyId, String batchNumber,
                                                            com.checkup.pharmacy.common.enums.BatchStatus status);

    List<Inventory> findByPharmacyIdAndMedicineIdAndBatchNumberAndStatus(
            String pharmacyId, String medicineId, String batchNumber, com.checkup.pharmacy.common.enums.BatchStatus status);

    /** Calendar auto-derived "expiry alert" events for a date-range view. */
    @Query("""
            SELECT i FROM Inventory i LEFT JOIN FETCH i.medicine
            WHERE i.pharmacyId = :pharmacyId AND CAST(i.status AS string) = 'ACTIVE'
              AND i.expiryDate >= :from AND i.expiryDate <= :to
            ORDER BY i.expiryDate ASC
            """)
    List<Inventory> findExpiringBatchesInRange(@Param("pharmacyId") String pharmacyId,
                                               @Param("from") Instant from, @Param("to") Instant to);

    @Query("""
            SELECT COUNT(i) FROM Inventory i
            WHERE i.pharmacyId = :pharmacyId AND CAST(i.status AS string) = 'ACTIVE'
              AND i.expiryDate >= :from AND i.expiryDate <= :to
            """)
    long countExpiringBatchesInRange(@Param("pharmacyId") String pharmacyId,
                                     @Param("from") Instant from, @Param("to") Instant to);

    /** All active stock — powers inventory valuation (grouped by medicine or category in the service). */
    @Query("SELECT i FROM Inventory i LEFT JOIN FETCH i.medicine WHERE i.pharmacyId = :pharmacyId AND CAST(i.status AS string) = 'ACTIVE'")
    List<Inventory> findActiveWithMedicine(@Param("pharmacyId") String pharmacyId);

    /** Active, in-stock batches — candidates for the dead-stock report (last-sale lookup happens separately). */
    @Query("""
            SELECT i FROM Inventory i LEFT JOIN FETCH i.medicine
            WHERE i.pharmacyId = :pharmacyId AND CAST(i.status AS string) = 'ACTIVE' AND i.quantity > 0
            """)
    List<Inventory> findActiveInStockWithMedicine(@Param("pharmacyId") String pharmacyId);

    /** Live (ACTIVE, non-expired) batches for a set of medicines — powers the billing alternatives drawer's stock column. */
    @Query("""
            SELECT i FROM Inventory i
            WHERE i.pharmacyId = :pharmacyId AND i.medicineId IN :medicineIds
              AND CAST(i.status AS string) = 'ACTIVE' AND i.expiryDate > :now
            ORDER BY i.expiryDate ASC
            """)
    List<Inventory> findActiveNonExpiredByMedicineIdIn(@Param("pharmacyId") String pharmacyId,
                                                       @Param("medicineIds") java.util.Collection<String> medicineIds,
                                                       @Param("now") java.time.Instant now);
}
