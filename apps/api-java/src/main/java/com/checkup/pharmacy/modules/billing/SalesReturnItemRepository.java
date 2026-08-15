package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.tax.TaxabilitySplitRow;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
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

    interface CreditNoteRow extends TaxabilitySplitRow {
    }

    /**
     * Credit notes raised in the period, split the same way as outward supplies.
     *
     * <p>GSTR-3B Table 3.1 is filed NET of credit notes issued in the period. Without this a
     * month containing a large refund overstates both the supply value and the tax payable on
     * it, and the pharmacy pays tax on money it gave back.
     *
     * <p>Keyed on the return's own date, not the original invoice's: a credit note belongs to
     * the period it was issued in, which is what stops a closed month from moving after it
     * has been filed.
     */
    @Query("""
            SELECT CASE WHEN sri.gstRate > 0 THEN true ELSE false END AS taxable,
                   COALESCE(SUM(sri.taxableAmount), 0) AS taxableValue,
                   COALESCE(SUM(sri.igst), 0) AS igst,
                   COALESCE(SUM(sri.cgst), 0) AS cgst,
                   COALESCE(SUM(sri.sgst), 0) AS sgst
            FROM SalesReturnItem sri
            JOIN SalesReturn sr ON sr.id = sri.returnId
            WHERE sri.pharmacyId = :pharmacyId
              AND sr.createdAt >= :from AND sr.createdAt <= :to
            GROUP BY CASE WHEN sri.gstRate > 0 THEN true ELSE false END
            """)
    List<CreditNoteRow> creditNotesByTaxability(@Param("pharmacyId") String pharmacyId,
                                                @Param("from") java.time.Instant from,
                                                @Param("to") java.time.Instant to);

    /**
     * The credit-note side of Table 3.2, bucketed by place of supply exactly as the outward
     * side is — see {@code InvoiceItemRepository.interstateSuppliesByPlaceOfSupply}.
     *
     * <p>3.2 is declared as a subset of 3.1(a) ("of the supplies shown in 3.1(a)"), and the
     * portal validates that. 3.1(a) is filed net of the period's credit notes, so 3.2 has to
     * be netted the same way and by the same rule, or a month containing a refund on an
     * inter-state sale reports a subset larger than the set it belongs to and the return is
     * rejected on submission.
     *
     * <p>Place of supply is read through the ORIGINAL invoice's customer, not the return's own
     * customerId: a credit note reverses a specific supply and belongs to wherever that supply
     * was made. The {@code isInterstate} flag is likewise the invoice's, so a credit note can
     * never be classified differently from the sale it reverses.
     *
     * <p>Dated on the return, not the invoice — same reasoning as
     * {@link #creditNotesByTaxability}: a credit note belongs to the period it was issued in,
     * which is what stops a filed month from moving afterwards.
     */
    @Query("""
            SELECT c.state AS placeOfSupply,
                   COALESCE(SUM(sri.taxableAmount), 0) AS taxableValue,
                   COALESCE(SUM(sri.igst), 0) AS igst
            FROM SalesReturnItem sri
            JOIN SalesReturn sr ON sr.id = sri.returnId
            JOIN Invoice inv ON inv.id = sr.invoiceId
            LEFT JOIN Customer c ON c.id = inv.customerId
            WHERE sri.pharmacyId = :pharmacyId
              AND inv.isInterstate = true
              AND sri.gstRate > 0
              AND sr.createdAt >= :from AND sr.createdAt <= :to
            GROUP BY c.state
            """)
    List<com.checkup.pharmacy.modules.billing.InvoiceItemRepository.PlaceOfSupplyRow>
            interstateCreditNotesByPlaceOfSupply(@Param("pharmacyId") String pharmacyId,
                                                 @Param("from") java.time.Instant from,
                                                 @Param("to") java.time.Instant to);

    interface ReturnMarginRow {
        /** Refunded value net of GST — the mirror of an invoice line's taxableAmount. */
        BigDecimal getRefundExGst();
        /** Cost of returned stock that went back on the shelf, so the pharmacy got it back. */
        BigDecimal getRestockedCost();
        /** Cost of returned stock that was written off — refunded AND destroyed. */
        BigDecimal getWrittenOffCost();
        long getUnitsReturned();
    }

    /**
     * The returns side of the gross-margin report, for a date range.
     *
     * <p>Without this the margin report reads a refund as if it never happened: the
     * original sale still counts as revenue, so a month where a big bill came back looks
     * exactly as profitable as one where it did not.
     *
     * <p>Restocked and written-off cost are kept apart deliberately, because they are not
     * the same event. A RESTOCK returns the goods to inventory, so the pharmacy loses the
     * revenue but recovers the cost. A WRITEOFF loses both — the refund goes out AND the
     * stock is destroyed — and that difference is the whole reason to look at a returns
     * figure at all.
     *
     * <p>Cost comes from the ORIGINAL invoice line's purchaseRate, joined through
     * {@code invoiceItemId}: sales_return_items records what was refunded, never what the
     * batch cost. The join is a LEFT one so a return whose original line has since gone
     * still contributes its refund rather than dropping the whole row.
     */
    @Query("""
            SELECT COALESCE(SUM(sri.taxableAmount), 0) AS refundExGst,
                   COALESCE(SUM(CASE WHEN sri.disposition = :restock THEN ii.purchaseRate * sri.quantity ELSE 0 END), 0) AS restockedCost,
                   COALESCE(SUM(CASE WHEN sri.disposition <> :restock THEN ii.purchaseRate * sri.quantity ELSE 0 END), 0) AS writtenOffCost,
                   COALESCE(SUM(sri.quantity), 0) AS unitsReturned
            FROM SalesReturnItem sri
            JOIN SalesReturn sr ON sr.id = sri.returnId
            LEFT JOIN InvoiceItem ii ON ii.id = sri.invoiceItemId
            WHERE sri.pharmacyId = :pharmacyId
              AND sr.createdAt >= :from AND sr.createdAt <= :to
            """)
    ReturnMarginRow returnMarginTotals(@Param("pharmacyId") String pharmacyId,
                                       @Param("from") java.time.Instant from, @Param("to") java.time.Instant to,
                                       @Param("restock") com.checkup.pharmacy.common.enums.ReturnDisposition restock);
}
