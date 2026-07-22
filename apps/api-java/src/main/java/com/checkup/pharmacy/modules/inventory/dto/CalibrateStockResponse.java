package com.checkup.pharmacy.modules.inventory.dto;

import java.util.List;

/**
 * "Smart Stock Levels" — recomputes each medicine's minimum-stock threshold from
 * its trailing 90-day sales velocity: {@code avgDailySales × 7 days × 1.5 safety},
 * floored at 5 units. {@code dryRun=true} previews the change without writing it.
 */
public record CalibrateStockResponse(int analyzed, int updated, int skipped, List<Change> changes) {

    public record Change(String medicineId, String medicineName, int oldMin, int newMin, double avgDailySales) {
    }
}
