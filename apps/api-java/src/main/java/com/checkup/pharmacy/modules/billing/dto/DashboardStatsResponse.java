package com.checkup.pharmacy.modules.billing.dto;

import java.math.BigDecimal;
import java.util.List;

/**
 * Homepage/Sales-page KPI card data. Matches the frontend's DashboardStats type (which omits
 * {@code paymentBreakdown} in its declaration, but the old Node backend returned it, so it's
 * kept here as a harmless extra field).
 */
public record DashboardStatsResponse(
        BigDecimal todaySales, long todayCount, long todayCancelled, BigDecimal todayReturns,
        BigDecimal last7DaysSales, long last7DaysCount, BigDecimal monthSales, long monthCount,
        BigDecimal pendingCredit, List<PaymentBreakdown> paymentBreakdown, long lowStockCount, long nearExpiryCount
) {
    public record PaymentBreakdown(String mode, BigDecimal total, long count) {
    }
}
