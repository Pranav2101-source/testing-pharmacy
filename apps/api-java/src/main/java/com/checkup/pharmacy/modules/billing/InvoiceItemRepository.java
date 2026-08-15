package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.tax.TaxabilitySplitRow;
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

    // ── GSTR-3B outward supplies ───────────────────────────────────────────────

    /** Taxable half is 3.1(a), nil-rated half is 3.1(c). */
    interface OutwardSupplyRow extends TaxabilitySplitRow {
    }

    /**
     * Table 3.1 of GSTR-3B, split into its taxable and nil-rated halves in one pass.
     *
     * <p>Split on the LINE's gstRate, not on the invoice: a single bill routinely mixes a 12%
     * medicine with a nil-rated one, and 3.1(a) and 3.1(c) are different rows of the return.
     * Grouping by {@code gstRate > 0} is what keeps a mixed bill from landing entirely in
     * whichever bucket its first line happened to fall into.
     */
    @Query("""
            SELECT CASE WHEN i.gstRate > 0 THEN true ELSE false END AS taxable,
                   COALESCE(SUM(i.taxableAmount), 0) AS taxableValue,
                   COALESCE(SUM(i.igst), 0) AS igst,
                   COALESCE(SUM(i.cgst), 0) AS cgst,
                   COALESCE(SUM(i.sgst), 0) AS sgst
            FROM InvoiceItem i
            WHERE i.invoice.pharmacyId = :pharmacyId AND i.invoice.isCancelled = false
              AND i.invoice.createdAt >= :from AND i.invoice.createdAt <= :to
            GROUP BY CASE WHEN i.gstRate > 0 THEN true ELSE false END
            """)
    List<OutwardSupplyRow> outwardSuppliesByTaxability(@Param("pharmacyId") String pharmacyId,
                                                       @Param("from") Instant from, @Param("to") Instant to);

    /** One place-of-supply bucket. A null/blank state is the "could not be determined" bucket. */
    interface PlaceOfSupplyRow {
        String getPlaceOfSupply();
        BigDecimal getTaxableValue();
        BigDecimal getIgst();
    }

    /**
     * Table 3.2 of GSTR-3B — of the supplies in 3.1(a), those made inter-state, by the state
     * they were supplied to.
     *
     * <p>BUILT FROM THE SAME LINES AS 3.1(a), AND THAT IS THE WHOLE POINT. This used to read
     * invoice-level {@code taxableAmount} and {@code igst} while 3.1(a) was summed from line
     * items filtered to {@code gstRate > 0}. Three consequences, all of which made the sheet
     * fail the portal's own validation that 3.2 cannot exceed 3.1(a):
     *
     * <ul>
     *   <li><b>Nil-rated value leaked in.</b> A pharmacy routinely sells a 12% medicine and a
     *       nil-rated one on the same bill. The invoice header carries both; 3.1(a) carries
     *       only the taxable line, and the nil-rated one belongs in 3.1(c). So the same rupees
     *       appeared in 3.2 and in 3.1(c) while being absent from 3.1(a).</li>
     *   <li><b>Credit notes were never deducted.</b> 3.1(a) is filed net of them; 3.2 was not,
     *       so any refund against an inter-state sale widened the gap further.</li>
     *   <li><b>Rows silently vanished.</b> An INNER join to Customer plus a
     *       {@code state <> ''} test dropped inter-state invoices that had no customer at all,
     *       or whose customer's state was cleared after the sale — leaving their IGST inside
     *       3.1(a) with no 3.2 row to account for it.</li>
     * </ul>
     *
     * <p>The join is now a LEFT one and nothing is filtered on state. Lines whose place of
     * supply cannot be determined come back under a null key so the caller can report them as
     * an explicit unknown rather than losing them: on a tax return "nowhere" and "not recorded"
     * must not look the same. Null, empty and whitespace states are folded together by the
     * caller, because {@code ' '} is a value this column really holds.
     */
    @Query("""
            SELECT c.state AS placeOfSupply,
                   COALESCE(SUM(i.taxableAmount), 0) AS taxableValue,
                   COALESCE(SUM(i.igst), 0) AS igst
            FROM InvoiceItem i
            LEFT JOIN Customer c ON c.id = i.invoice.customerId
            WHERE i.invoice.pharmacyId = :pharmacyId AND i.invoice.isCancelled = false
              AND i.invoice.isInterstate = true
              AND i.gstRate > 0
              AND i.invoice.createdAt >= :from AND i.invoice.createdAt <= :to
            GROUP BY c.state
            """)
    List<PlaceOfSupplyRow> interstateSuppliesByPlaceOfSupply(@Param("pharmacyId") String pharmacyId,
                                                             @Param("from") Instant from, @Param("to") Instant to);

    // ── Gross margin ───────────────────────────────────────────────────────────
    //
    // Every figure below compares taxableAmount against purchaseRate, and both
    // choices are load-bearing:
    //
    //   * taxableAmount, not amount. `amount` includes the GST the pharmacy
    //     collects on the state's behalf and remits — counting it as revenue
    //     would inflate margin by the whole GST rate (a 5% line would read ~5
    //     points better than it is). taxableAmount is also already net of BOTH
    //     the line discount and the bill-level discount, because GstCalculator
    //     folds the bill discount into the line before deriving tax. So it is
    //     exactly "what the pharmacy kept, before cost".
    //
    //   * quantity + freeQty, not quantity. BillingService decrements stock by
    //     quantity + freeQty (`int dispensed = quantity + freeQty`). Free goods
    //     earn no revenue but they DID cost money and they DID leave the shelf.
    //     Costing only the charged units would report a scheme-heavy month as
    //     more profitable than it was — the exact month where the pharmacist
    //     most needs the true number.

    interface MarginTotalsRow {
        BigDecimal getRevenueExGst();
        BigDecimal getCogs();
        Long getUnitsSold();
        Long getLineCount();
        /** Lines whose cost was never recorded — see {@code getRevenueMissingCost}. */
        Long getLinesMissingCost();
        /**
         * Revenue on lines carrying no purchase rate. Those lines contribute revenue and
         * zero cost, so they read as 100% margin and silently inflate the total. The
         * caller surfaces this instead of quietly absorbing it.
         */
        BigDecimal getRevenueMissingCost();
    }

    @Query("""
            SELECT COALESCE(SUM(i.taxableAmount), 0) AS revenueExGst,
                   COALESCE(SUM(i.purchaseRate * (i.quantity + i.freeQty)), 0) AS cogs,
                   COALESCE(SUM(i.quantity), 0) AS unitsSold,
                   COUNT(i) AS lineCount,
                   COALESCE(SUM(CASE WHEN i.purchaseRate IS NULL OR i.purchaseRate = 0 THEN 1 ELSE 0 END), 0) AS linesMissingCost,
                   COALESCE(SUM(CASE WHEN i.purchaseRate IS NULL OR i.purchaseRate = 0 THEN i.taxableAmount ELSE 0 END), 0) AS revenueMissingCost
            FROM InvoiceItem i
            WHERE i.invoice.pharmacyId = :pharmacyId AND i.invoice.isCancelled = false
              AND i.invoice.createdAt >= :from AND i.invoice.createdAt <= :to
            """)
    MarginTotalsRow marginTotals(@Param("pharmacyId") String pharmacyId,
                                 @Param("from") Instant from, @Param("to") Instant to);

    interface MarginGroupRow {
        String getInventoryId();
        BigDecimal getRevenueExGst();
        BigDecimal getCogs();
        Long getQty();
    }

    /**
     * Where the profit came from — grouped by batch, biggest contributor first.
     *
     * <p>Grouped by inventoryId rather than medicine because that is the column on the
     * line; the caller rolls batches up into medicines afterwards, exactly as the
     * fast/slow-moving reports do. Bounded by {@code Limit} — this feeds a table, while
     * the honest overall total comes from {@link #marginTotals} over every row.
     */
    @Query("""
            SELECT i.inventoryId AS inventoryId,
                   COALESCE(SUM(i.taxableAmount), 0) AS revenueExGst,
                   COALESCE(SUM(i.purchaseRate * (i.quantity + i.freeQty)), 0) AS cogs,
                   COALESCE(SUM(i.quantity), 0) AS qty
            FROM InvoiceItem i
            WHERE i.invoice.pharmacyId = :pharmacyId AND i.invoice.isCancelled = false
              AND i.invoice.createdAt >= :from AND i.invoice.createdAt <= :to
            GROUP BY i.inventoryId
            ORDER BY SUM(i.taxableAmount) - SUM(i.purchaseRate * (i.quantity + i.freeQty)) DESC
            """)
    List<MarginGroupRow> marginByInventory(@Param("pharmacyId") String pharmacyId,
                                           @Param("from") Instant from, @Param("to") Instant to, Limit limit);

    /**
     * Batches sold for less than they cost, worst first.
     *
     * <p>The one panel on this report that is a worklist rather than a number. Selling
     * below cost is not rare in a pharmacy — a stale MRP, a scheme price entered as the
     * purchase rate, a discount stacked on an already-thin line — and it is invisible
     * without this query, because the medicine still shows up as "top selling".
     *
     * <p>Excludes zero-cost lines: those are missing data, not losses, and mixing the two
     * would bury the real cases under noise.
     */
    @Query("""
            SELECT i.inventoryId AS inventoryId,
                   COALESCE(SUM(i.taxableAmount), 0) AS revenueExGst,
                   COALESCE(SUM(i.purchaseRate * (i.quantity + i.freeQty)), 0) AS cogs,
                   COALESCE(SUM(i.quantity), 0) AS qty
            FROM InvoiceItem i
            WHERE i.invoice.pharmacyId = :pharmacyId AND i.invoice.isCancelled = false
              AND i.invoice.createdAt >= :from AND i.invoice.createdAt <= :to
              AND i.purchaseRate > 0
            GROUP BY i.inventoryId
            HAVING SUM(i.taxableAmount) < SUM(i.purchaseRate * (i.quantity + i.freeQty))
            ORDER BY SUM(i.taxableAmount) - SUM(i.purchaseRate * (i.quantity + i.freeQty)) ASC
            """)
    List<MarginGroupRow> lossMakingByInventory(@Param("pharmacyId") String pharmacyId,
                                               @Param("from") Instant from, @Param("to") Instant to, Limit limit);
}
