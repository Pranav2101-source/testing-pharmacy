package com.checkup.pharmacy.modules.billing;

import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public interface InvoiceItemRepository extends JpaRepository<InvoiceItem, String> {

    List<InvoiceItem> findByInvoiceId(String invoiceId);

    /** Rollback guard: how many of these batches have been billed. */
    long countByInventoryIdIn(java.util.Collection<String> inventoryIds);

    @Query("SELECT i.invoiceId AS invoiceId, COUNT(i) AS cnt FROM InvoiceItem i WHERE i.invoiceId IN :invoiceIds GROUP BY i.invoiceId")
    List<InvoiceCountRow> countByInvoiceIdIn(@Param("invoiceIds") List<String> invoiceIds);

    interface InvoiceCountRow {
        String getInvoiceId();
        long getCnt();
    }

    // ── Reporting ──────────────────────────────────────────────────────────────

    interface MovementGroupRow {
        String getInventoryId();
        Long getQty();
        BigDecimal getRevenue();
    }

    @Query("""
            SELECT i.inventoryId AS inventoryId, COALESCE(SUM(i.quantity), 0) AS qty, COALESCE(SUM(i.amount), 0) AS revenue
            FROM InvoiceItem i
            WHERE i.invoice.pharmacyId = :pharmacyId AND i.invoice.isCancelled = false
              AND i.invoice.createdAt >= :from AND i.invoice.createdAt <= :to
            GROUP BY i.inventoryId
            ORDER BY SUM(i.quantity) DESC
            """)
    List<MovementGroupRow> fastMovingInRange(@Param("pharmacyId") String pharmacyId,
                                             @Param("from") Instant from, @Param("to") Instant to, Limit limit);

    @Query("""
            SELECT i.inventoryId AS inventoryId, COALESCE(SUM(i.quantity), 0) AS qty, COALESCE(SUM(i.amount), 0) AS revenue
            FROM InvoiceItem i
            WHERE i.invoice.pharmacyId = :pharmacyId AND i.invoice.isCancelled = false
              AND i.invoice.createdAt >= :from AND i.invoice.createdAt <= :to
            GROUP BY i.inventoryId
            HAVING SUM(i.quantity) >= :minQty
            ORDER BY SUM(i.quantity) ASC
            """)
    List<MovementGroupRow> slowMovingInRange(@Param("pharmacyId") String pharmacyId,
                                             @Param("from") Instant from, @Param("to") Instant to,
                                             @Param("minQty") int minQty, Limit limit);

    @Query("""
            SELECT i.inventoryId AS inventoryId, COALESCE(SUM(i.quantity), 0) AS qty, COALESCE(SUM(i.amount), 0) AS revenue
            FROM InvoiceItem i
            WHERE i.invoice.pharmacyId = :pharmacyId AND i.invoice.isCancelled = false
              AND i.invoice.createdAt >= :since
            GROUP BY i.inventoryId
            ORDER BY SUM(i.quantity) DESC
            """)
    List<MovementGroupRow> topItemsSince(@Param("pharmacyId") String pharmacyId,
                                        @Param("since") Instant since, Limit limit);

    interface HsnRawRow {
        String getHsnCode();
        BigDecimal getGstRate();
        BigDecimal getTaxableAmount();
        BigDecimal getCgst();
        BigDecimal getSgst();
        BigDecimal getIgst();
        BigDecimal getAmount();
        /** Long, not Integer: this is now a SUM, and Hibernate widens an integer sum. */
        Long getQuantity();
    }

    /**
     * GSTR-1 HSN summary, aggregated BY THE DATABASE.
     *
     * <p>This previously selected one row per invoice line and summed them in Java,
     * with no bound of any kind. A GSTR-1 return is filed per month, but nothing stops
     * a pharmacist asking for a quarter or a year — and at that size the query returns
     * every line item the pharmacy has sold, transfers them all, materialises them all,
     * and throws almost all of them away to produce the dozen rows the screen shows.
     * On a busy pharmacy that is the difference between a report and a timeout.
     *
     * <p>GROUP BY collapses it in SQL, so the row count is bounded by the number of
     * distinct (HSN, rate) pairs the pharmacy actually sells — tens, not hundreds of
     * thousands. Grouping also treats NULL hsnCode as a single group, which is what
     * the caller's "UNCLASSIFIED" bucket wants.
     */
    @Query("""
            SELECT i.hsnCode AS hsnCode, i.gstRate AS gstRate,
                   COALESCE(SUM(i.taxableAmount), 0) AS taxableAmount,
                   COALESCE(SUM(i.cgst), 0) AS cgst, COALESCE(SUM(i.sgst), 0) AS sgst,
                   COALESCE(SUM(i.igst), 0) AS igst, COALESCE(SUM(i.amount), 0) AS amount,
                   COALESCE(SUM(i.quantity), 0) AS quantity
            FROM InvoiceItem i
            WHERE i.invoice.pharmacyId = :pharmacyId AND i.invoice.isCancelled = false
              AND i.invoice.createdAt >= :from AND i.invoice.createdAt <= :to
            GROUP BY i.hsnCode, i.gstRate
            ORDER BY i.hsnCode, i.gstRate
            """)
    List<HsnRawRow> hsnSummaryItems(@Param("pharmacyId") String pharmacyId,
                                    @Param("from") Instant from, @Param("to") Instant to);

    /**
     * Schedule H/H1/X register rows for a date range.
     *
     * <p><b>Takes a Pageable purely as a safety bound.</b> This was previously
     * unbounded: it returns fully-fetched entities across five joins, so a wide
     * date range on a pharmacy with real history would pull tens of thousands of
     * rows into the persistence context in a single request — holding one of only
     * five database connections while doing it, and risking an OutOfMemoryError
     * that takes the whole service down rather than just failing the report. At a
     * modest 1,200 invoices the response was already 78 KB.
     *
     * <p>The caller requests one row beyond its display cap and <b>fails loudly</b>
     * if that row exists, rather than truncating. This is a legal drug register:
     * silently returning an incomplete one is worse than returning none, because
     * nobody can tell it is incomplete.
     *
     * <p>All five fetches are to-one, so pagination is applied in SQL. A collection
     * fetch here would instead trigger Hibernate's in-memory paging (HHH000104) and
     * defeat the entire point of the bound.
     */
    @Query("""
            SELECT i FROM InvoiceItem i
            LEFT JOIN FETCH i.invoice inv LEFT JOIN FETCH inv.customer LEFT JOIN FETCH inv.user
            LEFT JOIN FETCH i.inventory inventory LEFT JOIN FETCH inventory.medicine
            WHERE inv.pharmacyId = :pharmacyId AND inv.isCancelled = false
              AND inv.createdAt >= :from AND inv.createdAt <= :to
              AND inventory.medicine.schedule IN :schedules
            ORDER BY inv.createdAt DESC
            """)
    List<InvoiceItem> scheduleRegisterItems(@Param("pharmacyId") String pharmacyId,
                                            @Param("from") Instant from, @Param("to") Instant to,
                                            @Param("schedules") List<String> schedules,
                                            org.springframework.data.domain.Pageable pageable);
}
