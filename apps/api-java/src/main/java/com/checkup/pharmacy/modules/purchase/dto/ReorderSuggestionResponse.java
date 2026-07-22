package com.checkup.pharmacy.modules.purchase.dto;

import java.math.BigDecimal;

/**
 * A medicine projected to run out within the caller's requested threshold, based on its
 * trailing 30-day sales velocity. {@code suggestedQuantity} tops the current stock back up
 * to {@code daysThreshold} days of cover plus a 50% safety margin (same factor as
 * inventory's "Smart Stock Levels" calibration, for a consistent reorder philosophy).
 */
public record ReorderSuggestionResponse(
        String medicineId,
        String medicineName,
        int currentStock,
        double avgDailySales,
        int daysOfStock,
        int suggestedQuantity,
        int minimumStock,
        BigDecimal lastPurchaseRate,
        BigDecimal lastMrp,
        BigDecimal lastGstRate
) {
}
