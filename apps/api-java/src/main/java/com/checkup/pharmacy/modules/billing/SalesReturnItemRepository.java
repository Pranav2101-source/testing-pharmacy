package com.checkup.pharmacy.modules.billing;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface SalesReturnItemRepository extends JpaRepository<SalesReturnItem, String> {

    List<SalesReturnItem> findByReturnId(String returnId);

    /** Rollback guard: how many of these batches appear on a sales return. */
    long countByInventoryIdIn(java.util.Collection<String> inventoryIds);

    /**
     * Returned-unit totals for a page of returns in ONE query. The returns list shows only a
     * units-returned figure per row, so loading every line of every return (an N+1) just to sum
     * `quantity` was pure waste. Backed by the {@code sales_return_items(returnId)} index.
     */
    @Query("SELECT i.returnId AS returnId, COALESCE(SUM(i.quantity), 0) AS totalQuantity "
            + "FROM SalesReturnItem i WHERE i.pharmacyId = :pharmacyId AND i.returnId IN :returnIds "
            + "GROUP BY i.returnId")
    List<ReturnQuantityRow> sumQuantityByReturnIdIn(@Param("pharmacyId") String pharmacyId,
                                                    @Param("returnIds") List<String> returnIds);

    interface ReturnQuantityRow {
        String getReturnId();
        long getTotalQuantity();
    }

    /** Every return line ever raised against this invoice, across all its returns — used for the over-return guard. */
    @Query("SELECT sri FROM SalesReturnItem sri WHERE sri.returnId IN (SELECT sr.id FROM SalesReturn sr WHERE sr.invoiceId = :invoiceId)")
    List<SalesReturnItem> findByInvoiceId(@Param("invoiceId") String invoiceId);
}
