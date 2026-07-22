package com.checkup.pharmacy.modules.inventory.dto;

import java.util.List;

public record AlertsResponse(List<ExpiryAlert> expiry, List<LowStockAlert> lowStock) {

    /** tier: EXPIRED | CRITICAL (<=30d) | WARNING (<=60d) | NOTICE (<=90d) */
    public record ExpiryAlert(InventoryResponse batch, String tier, int daysToExpiry) {
    }

    /** tier: OUT_OF_STOCK | REORDER (<=reorderLevel) | LOW (<=minimumStock) */
    public record LowStockAlert(InventoryResponse batch, String tier) {
    }
}
