package com.checkup.pharmacy.modules.reports.dto;

import java.math.BigDecimal;

/** Mirrors the frontend's GstData shape — a raw Prisma aggregate() result (`_sum`/`_count`), passed through as-is. */
public record GstSummaryResponse(Sum _sum, long _count) {

    /**
     * The period's invoice totals, column by column.
     *
     * <p>{@code extraCharges}, {@code adjustmentAmount} and {@code roundOff} are here because
     * without them this summary does not add up. An invoice satisfies, from its own columns:
     *
     * <pre>taxableAmount + totalGst + extraCharges + adjustmentAmount + roundOff == totalAmount</pre>
     *
     * <p>The summary reported the first two and the last one and nothing in between, so any
     * period containing a delivery charge, a manual adjustment or the ordinary rupee round-off
     * showed a Taxable and a Total GST that did not reconcile to the Net Invoice Value beside
     * them — with no row on the screen that could explain the gap. On the tab a GSTR-1 is
     * transcribed from, an unexplained difference is something a person has to chase.
     *
     * <p>They are NOT part of the taxable value and carry no GST here: extra charges recorded
     * this way are a flat addition to the bill, not a taxable supply. If a pharmacy starts
     * charging something that IS taxable, it belongs on a line item with its own HSN and rate,
     * not in this column.
     */
    public record Sum(BigDecimal subtotal, BigDecimal discountAmount, BigDecimal taxableAmount, BigDecimal cgst,
                      BigDecimal sgst, BigDecimal igst, BigDecimal totalGst,
                      BigDecimal extraCharges, BigDecimal adjustmentAmount, BigDecimal roundOff,
                      BigDecimal totalAmount) {
    }
}
