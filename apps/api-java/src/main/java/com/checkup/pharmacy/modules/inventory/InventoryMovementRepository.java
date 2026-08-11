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
}
