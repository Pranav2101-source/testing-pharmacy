package com.checkup.pharmacy.modules.reports.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record DeadStockResponse(int thresholdDays, BigDecimal totalCostAtRisk, List<Item> items) {

    /**
     * @param quantity   sealed packs on hand — unchanged meaning, packs
     * @param looseUnits loose pieces left from an opened strip, 0 for a pack-only medicine.
     *                   {@code costAtRisk}/{@code retailValue} already fold this in; carried
     *                   separately too so the screen can show "+N loose" the way the rest of
     *                   the app does, rather than a bare pack count that looks lower than
     *                   what is actually at risk.
     */
    public record Item(String id, String batchNumber, Instant expiryDate, int quantity, int looseUnits,
                       BigDecimal costAtRisk, BigDecimal retailValue, Instant lastSaleDate, MedicineRef medicine) {
    }

    public record MedicineRef(String id, String name, String genericName, String form, String category) {
    }
}
