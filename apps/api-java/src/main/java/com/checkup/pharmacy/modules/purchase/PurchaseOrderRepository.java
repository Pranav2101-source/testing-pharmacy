package com.checkup.pharmacy.modules.purchase;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface PurchaseOrderRepository extends JpaRepository<PurchaseOrder, String> {

    @Query("SELECT po FROM PurchaseOrder po LEFT JOIN FETCH po.supplier WHERE po.id = :id AND po.pharmacyId = :pharmacyId")
    Optional<PurchaseOrder> findByIdAndPharmacyId(@Param("id") String id, @Param("pharmacyId") String pharmacyId);

    /**
     * status/approvalStatus compared as text — binding a null value typed as the
     * Postgres custom enum fails with "could not determine data type of parameter"
     * (SQLState 42P18); see InventoryRepository.search for the same pattern.
     * hasStatus/statuses implement the optional IN-list filter (an empty bind list
     * is invalid SQL, so the caller passes a non-empty placeholder when unused).
     * from/to are unconditional — the caller resolves absent bounds via
     * {@code common.util.DateRange} (see its javadoc: a genuinely null Instant
     * bound into a timestamp comparison breaks Postgres's parameter-type inference).
     */
    @Query("""
            SELECT po FROM PurchaseOrder po LEFT JOIN FETCH po.supplier
            WHERE po.pharmacyId = :pharmacyId
              AND (:hasStatus = false OR CAST(po.status AS string) IN :statuses)
              AND (:approvalStatus IS NULL OR CAST(po.approvalStatus AS string) = :approvalStatus)
              AND (:supplierId IS NULL OR po.supplierId = :supplierId)
              AND po.orderedAt >= :from AND po.orderedAt <= :to
              AND (:search IS NULL
                   OR LOWER(po.orderNumber) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(COALESCE(po.invoiceNo, '')) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(po.supplier.name) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%')))
            ORDER BY po.orderedAt DESC
            """)
    Page<PurchaseOrder> search(@Param("pharmacyId") String pharmacyId,
                               @Param("hasStatus") boolean hasStatus,
                               @Param("statuses") List<String> statuses,
                               @Param("approvalStatus") String approvalStatus,
                               @Param("supplierId") String supplierId,
                               @Param("from") Instant from,
                               @Param("to") Instant to,
                               @Param("search") String search,
                               Pageable pageable);

    @Query("SELECT po.supplierId AS supplierId, COUNT(po) AS total FROM PurchaseOrder po " +
            "WHERE po.pharmacyId = :pharmacyId AND po.supplierId IN :supplierIds GROUP BY po.supplierId")
    List<SupplierPoCountRow> countBySupplierIdIn(@Param("pharmacyId") String pharmacyId,
                                                  @Param("supplierIds") List<String> supplierIds);

    interface SupplierPoCountRow {
        String getSupplierId();
        long getTotal();
    }

    /**
     * id + orderNumber for a set of POs, in ONE query — the GRN list only needs the
     * linked order's number, so loading each full PurchaseOrder entity (with its JSON
     * items) per GRN row was both an N+1 and needless payload. Projection stays off the
     * heavy `items` column entirely.
     */
    @Query("SELECT po.id AS id, po.orderNumber AS orderNumber FROM PurchaseOrder po "
            + "WHERE po.pharmacyId = :pharmacyId AND po.id IN :ids")
    List<PoRefRow> findRefsByIdIn(@Param("pharmacyId") String pharmacyId, @Param("ids") List<String> ids);

    interface PoRefRow {
        String getId();
        String getOrderNumber();
    }

    /** Calendar auto-derived "PO delivery" events — orders not yet received/cancelled with an expected date in range. */
    @Query("""
            SELECT po FROM PurchaseOrder po LEFT JOIN FETCH po.supplier
            WHERE po.pharmacyId = :pharmacyId
              AND CAST(po.status AS string) NOT IN ('RECEIVED', 'CANCELLED')
              AND po.expectedDate >= :from AND po.expectedDate <= :to
            ORDER BY po.expectedDate ASC
            """)
    List<PurchaseOrder> findPendingDeliveriesInRange(@Param("pharmacyId") String pharmacyId,
                                                     @Param("from") Instant from, @Param("to") Instant to);

    long countByPharmacyIdAndApprovalStatus(String pharmacyId, com.checkup.pharmacy.common.enums.ApprovalStatus approvalStatus);
}
