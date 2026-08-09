package com.checkup.pharmacy.modules.reports.dto;

import java.math.BigDecimal;

/** Mirrors the frontend's GstData shape — a raw Prisma aggregate() result (`_sum`/`_count`), passed through as-is. */
public record GstSummaryResponse(Sum _sum, long _count) {

    public record Sum(BigDecimal subtotal, BigDecimal discountAmount, BigDecimal taxableAmount, BigDecimal cgst,
                      BigDecimal sgst, BigDecimal igst, BigDecimal totalGst, BigDecimal totalAmount) {
    }
}
