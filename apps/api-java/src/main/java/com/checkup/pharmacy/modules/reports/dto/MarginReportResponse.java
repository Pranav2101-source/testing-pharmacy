package com.checkup.pharmacy.modules.reports.dto;

import java.math.BigDecimal;
import java.util.List;

/**
 * Gross margin on what was actually sold in a period — the one figure this pharmacy
 * records on every line and has never been able to read back.
 *
 * <p>Every invoice line already stores {@code purchaseRate}, the batch cost at the moment
 * of sale, so cost of goods sold is exact rather than estimated: no average costing, no
 * inference from purchase history, no drift when the same medicine is bought at three
 * different prices. The existing purchase cost-analysis report answers "what did I pay",
 * which is a different question and cannot answer this one.
 *
 * @param revenueExGst   what customers paid, net of GST and net of every discount
 * @param cogs           what that stock cost, including free goods given away
 * @param returns        refunds and returned stock in the same period, kept separate so a
 *                       month with a large return is legible rather than merely lower
 * @param grossProfit    revenueExGst − cogs, after the returns adjustment
 * @param marginPct      grossProfit as a percentage of net revenue
 * @param dataQuality    how much of the period can actually be costed — see the record
 * @param topContributors where the profit came from, biggest first
 * @param lossMakers     sold below cost, worst first: a worklist, not a statistic
 */
public record MarginReportResponse(BigDecimal revenueExGst, BigDecimal cogs, Returns returns,
                                   BigDecimal grossProfit, BigDecimal marginPct, long unitsSold,
                                   DataQuality dataQuality,
                                   List<Item> topContributors, List<Item> lossMakers) {

    /**
     * @param refundExGst    refunded value, net of GST
     * @param restockedCost  cost of returned stock that went back on the shelf
     * @param writtenOffCost cost of returned stock that was destroyed — refunded AND lost
     * @param unitsReturned  units returned in the period
     */
    public record Returns(BigDecimal refundExGst, BigDecimal restockedCost, BigDecimal writtenOffCost,
                          long unitsReturned) {
    }

    /**
     * Honesty about the denominator.
     *
     * <p>A line with no recorded purchase rate contributes revenue and zero cost, so it
     * reads as pure profit and pulls the whole margin up. That is not a rounding
     * inconvenience — it is the difference between "you made 28%" and "you made 28% on
     * the four fifths of sales we can cost". Anything migrated from the previous system
     * lands here, so the caller shows this rather than absorbing it.
     *
     * @param costedRevenuePct share of net revenue with a real cost behind it, 0-100
     * @param linesMissingCost invoice lines carrying no purchase rate
     * @param revenueMissingCost net revenue on those lines
     */
    public record DataQuality(BigDecimal costedRevenuePct, long linesMissingCost,
                              BigDecimal revenueMissingCost, long totalLines) {
    }

    /**
     * @param marginPct margin on this medicine alone; negative means sold below cost
     */
    public record Item(String inventoryId, MedicineRef medicine, long qtySold,
                       BigDecimal revenueExGst, BigDecimal cogs, BigDecimal grossProfit,
                       BigDecimal marginPct, String batchNumber) {
    }

    public record MedicineRef(String id, String name, String genericName, String form) {
    }
}
