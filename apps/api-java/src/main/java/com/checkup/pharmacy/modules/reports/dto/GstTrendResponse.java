package com.checkup.pharmacy.modules.reports.dto;

import java.math.BigDecimal;
import java.util.List;

/**
 * Output tax per IST calendar month — the compliance tab's "is my GST liability
 * trending up" chart.
 *
 * <p>One row per month across the requested window, months with no sales included as
 * explicit zeros so the chart plots a continuous axis. {@code month} is {@code YYYY-MM}.
 */
public record GstTrendResponse(List<Month> months) {

    /**
     * @param taxable taxable value billed in the month, net of GST and discounts
     * @param cgst    central GST collected — intra-state half
     * @param sgst    state GST collected — the other intra-state half
     * @param igst    integrated GST collected — inter-state sales only
     * @param totalGst cgst + sgst + igst, precomputed
     */
    public record Month(String month, BigDecimal taxable, BigDecimal cgst, BigDecimal sgst,
                        BigDecimal igst, BigDecimal totalGst) {
    }
}
