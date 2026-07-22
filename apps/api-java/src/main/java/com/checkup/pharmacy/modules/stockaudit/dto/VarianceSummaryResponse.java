package com.checkup.pharmacy.modules.stockaudit.dto;

import java.time.Instant;
import java.util.List;

/** Dry-run preview of the stock adjustments that approving this session would apply. */
public record VarianceSummaryResponse(
        String sessionId,
        String sessionNumber,
        String status,
        int totalItems,
        List<Adjustment> adjustments,
        Summary summary
) {
    public record Adjustment(String inventoryId, String medicineName, String batchNumber, Instant expiryDate,
                             int currentQty, int expectedQty, Integer countedQty, Integer varianceQty,
                             String direction, int resultQty) {
    }

    public record Summary(int totalIn, int totalOut, int netVariance) {
    }
}
