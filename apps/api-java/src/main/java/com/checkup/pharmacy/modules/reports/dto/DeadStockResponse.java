package com.checkup.pharmacy.modules.reports.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record DeadStockResponse(int thresholdDays, BigDecimal totalCostAtRisk, List<Item> items) {

    public record Item(String id, String batchNumber, Instant expiryDate, int quantity, BigDecimal costAtRisk,
                       BigDecimal retailValue, Instant lastSaleDate, MedicineRef medicine) {
    }

    public record MedicineRef(String id, String name, String genericName, String form, String category) {
    }
}
