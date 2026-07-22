package com.checkup.pharmacy.modules.reports.dto;

import java.math.BigDecimal;
import java.util.List;

public record CostAnalysisResponse(Summary summary, List<Item> items) {

    public record Summary(BigDecimal totalCost, BigDecimal totalMRPValue, BigDecimal overallMarginPct) {
    }

    public record Item(String medicineId, String medicineName, int totalQty, BigDecimal totalCost,
                       BigDecimal totalMRPValue, BigDecimal avgPurchaseRate, BigDecimal avgMRP,
                       BigDecimal marginPct, int batches) {
    }
}
