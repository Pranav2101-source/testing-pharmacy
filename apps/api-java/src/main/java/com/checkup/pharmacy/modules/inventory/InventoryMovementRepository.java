package com.checkup.pharmacy.modules.inventory;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

public interface InventoryMovementRepository extends JpaRepository<InventoryMovement, String> {

    /** Rollback guard: movements on these batches that the import did NOT create. */
    long countByInventoryIdInAndReferenceTypeNot(java.util.Collection<String> inventoryIds, String referenceType);

    /**
     * type/direction compared as text to avoid the null-enum-parameter crash
     * (SQLState 42P18) — see InventoryRepository.search for the same pattern.
     * from/to are unconditional (no ":from IS NULL OR" guard): the caller
     * resolves absent bounds to a wide sentinel range via {@code DateRange}
     * before calling this method — see that class's javadoc for why binding a
     * genuinely null Instant into a timestamp comparison breaks under Postgres.
     */
    /**
     * {@code LEFT JOIN FETCH m.inventory} so the ledger page can read each row's batch number
     * (and, via inventory.medicineId, its medicine) without a lazy load per row — a 100-row
     * page was firing up to 100 extra queries in the response mapper. inventory is a to-ONE
     * relation, so the fetch join paginates safely; an explicit countQuery is still supplied
     * because Hibernate can't derive one from a fetch-join select.
     */
    @Query(value = """
            SELECT m FROM InventoryMovement m
            LEFT JOIN FETCH m.inventory inv
            WHERE m.pharmacyId = :pharmacyId
              AND (:inventoryId IS NULL OR m.inventoryId = :inventoryId)
              AND (:medicineId IS NULL OR inv.medicineId = :medicineId)
              AND (:userId IS NULL OR m.userId = :userId)
              AND (:type IS NULL OR CAST(m.type AS string) = :type)
              AND (:direction IS NULL OR CAST(m.direction AS string) = :direction)
              AND m.createdAt >= :from AND m.createdAt <= :to
            ORDER BY m.createdAt DESC
            """,
            countQuery = """
            SELECT COUNT(m) FROM InventoryMovement m
            WHERE m.pharmacyId = :pharmacyId
              AND (:inventoryId IS NULL OR m.inventoryId = :inventoryId)
              AND (:medicineId IS NULL OR m.inventory.medicineId = :medicineId)
              AND (:userId IS NULL OR m.userId = :userId)
              AND (:type IS NULL OR CAST(m.type AS string) = :type)
              AND (:direction IS NULL OR CAST(m.direction AS string) = :direction)
              AND m.createdAt >= :from AND m.createdAt <= :to
            """)
    Page<InventoryMovement> search(@Param("pharmacyId") String pharmacyId,
                                   @Param("inventoryId") String inventoryId,
                                   @Param("medicineId") String medicineId,
                                   @Param("userId") String userId,
                                   @Param("type") String type,
                                   @Param("direction") String direction,
                                   @Param("from") Instant from,
                                   @Param("to") Instant to,
                                   Pageable pageable);

    /**
     * Per-medicine sales velocity within a date range — powers "calibrate-stock" (total quantity
     * sold, to derive avg/day) and "frequent" quick-add (transaction count, to rank by popularity).
     * Joined against Invoice (cross-module, referenced by entity name only — no Java import needed)
     * to exclude cancelled sales: a SALE/OUT movement is never deleted when its invoice is later
     * cancelled (the ledger keeps the original entry plus a reversing ADJUSTMENT/IN one), so without
     * this filter a cancelled sale would still inflate both velocity and popularity.
     */
    @Query("""
            SELECT m.inventory.medicineId AS medicineId, COUNT(m) AS transactionCount, COALESCE(SUM(m.quantity), 0) AS totalQuantity
            FROM InventoryMovement m, Invoice i
            WHERE m.pharmacyId = :pharmacyId
              AND CAST(m.type AS string) = 'SALE' AND CAST(m.direction AS string) = 'OUT'
              AND m.referenceType = 'INVOICE' AND m.referenceId = i.id
              AND i.isCancelled = false
              AND m.createdAt >= :from AND m.createdAt <= :to
            GROUP BY m.inventory.medicineId
            ORDER BY COUNT(m) DESC
            """)
    List<MedicineSalesAggregateRow> aggregateSalesByMedicine(@Param("pharmacyId") String pharmacyId,
                                                              @Param("from") Instant from, @Param("to") Instant to);

    interface MedicineSalesAggregateRow {
        String getMedicineId();
        long getTransactionCount();
        long getTotalQuantity();
    }

    /** Most recent SALE movement per inventory batch — powers the dead-stock report's "last sale" column. */
    @Query("""
            SELECT m.inventoryId AS inventoryId, MAX(m.createdAt) AS lastSale
            FROM InventoryMovement m
            WHERE m.pharmacyId = :pharmacyId AND CAST(m.type AS string) = 'SALE'
              AND m.inventoryId IN :inventoryIds
            GROUP BY m.inventoryId
            """)
    List<LastSaleRow> findLastSaleByInventoryIdIn(@Param("pharmacyId") String pharmacyId,
                                                  @Param("inventoryIds") List<String> inventoryIds);

    interface LastSaleRow {
        String getInventoryId();
        Instant getLastSale();
    }

    List<InventoryMovement> findByInventoryIdInAndReferenceType(List<String> inventoryIds, String referenceType);

    interface ExpiryWriteOffRow {
        long getBatches();
        Long getUnits();
        java.math.BigDecimal getCost();
        java.math.BigDecimal getItc();
    }

    /**
     * Input tax credit blocked by expired stock written off in the period — GSTR-3B Table 4(B)(1).
     *
     * <p>Section 17(5)(h) blocks credit on goods "lost, stolen, destroyed, written off". Expired
     * medicine is destroyed by definition, so the credit claimed when it was bought has to be
     * reversed in the period it is disposed of — which is what makes the write-off the taxable
     * event, and why this reads movements rather than the current state of the batch.
     *
     * <p>ONLY {@code EXPIRY_REMOVAL}. Deliberately not "every OUT adjustment", which would be the
     * obvious wider net and would be wrong twice over: confirming a supplier return also writes
     * {@code ADJUSTMENT/OUT}, so those units would have their credit reversed HERE as well as in
     * Table 4(B)(2) through the debit note — the same rupees counted twice — and an ordinary
     * stock correction is not a disposal at all. A dedicated movement type is what keeps a tax
     * reversal from being inferred out of unrelated bookkeeping.
     *
     * <p>Cost comes from the batch's own {@code purchaseRate}, which survives the write-off (only
     * the quantity is zeroed), and the rate from the medicine. Both are current values; see
     * {@code InventoryRepository.expiredStockOnBooks} for the same caveat about which tax head
     * the credit was originally claimed under.
     */
    @Query("""
            SELECT COUNT(m) AS batches,
                   COALESCE(SUM(m.quantity), 0) AS units,
                   COALESCE(SUM(i.purchaseRate * m.quantity), 0) AS cost,
                   COALESCE(SUM(i.purchaseRate * m.quantity * med.gstRate / 100), 0) AS itc
            FROM InventoryMovement m
            JOIN Inventory i ON i.id = m.inventoryId
            JOIN Medicine med ON med.id = i.medicineId
            WHERE m.pharmacyId = :pharmacyId
              AND CAST(m.type AS string) = 'EXPIRY_REMOVAL'
              AND m.createdAt >= :from AND m.createdAt <= :to
            """)
    ExpiryWriteOffRow expiryWriteOffItc(@Param("pharmacyId") String pharmacyId,
                                        @Param("from") Instant from, @Param("to") Instant to);
}
