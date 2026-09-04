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
    /**
     * @param looseDirection/looseVarianceUnits/resultLooseUnits the same shape as
     *        direction/varianceQty/resultQty, for the batch's loose remainder — null when this
     *        item has no loose variance to apply (see StockAuditItem's own null-vs-zero note)
     */
    public record Adjustment(String inventoryId, String medicineName, String batchNumber, Instant expiryDate,
                             int currentQty, int expectedQty, Integer countedQty, Integer varianceQty,
                             String direction, int resultQty,
                             int currentLooseUnits, int expectedLooseUnits, Integer countedLooseUnits,
                             Integer varianceLooseUnits, String looseDirection, Integer resultLooseUnits) {
    }

    public record Summary(int totalIn, int totalOut, int netVariance) {
    }
}
