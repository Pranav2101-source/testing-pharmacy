package com.checkup.pharmacy.modules.inventory.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record AlertsResponse(List<ExpiryAlert> expiry, List<LowStockAlert> lowStock) {

    /**
     * Flattened onto the fields of {@link InventoryResponse} rather than nesting it under a
     * "batch" key — the frontend (AlertsTab.tsx) reads {@code item.medicine}, {@code
     * item.batchNumber}, etc. directly off each alert row, matching the shape the old Node
     * backend returned via {@code {...inventoryRow, tier, daysToExpiry, wasteRisk}}. A nested
     * "batch" object here would compile fine (the frontend casts the response with `as
     * AlertsResponse` and does not validate it at runtime) but every field access would read
     * undefined at runtime.
     *
     * <p>tier: EXPIRED | CRITICAL (&lt;=30d) | WARNING (&lt;=60d) | NOTICE (&lt;=90d)
     */
    public record ExpiryAlert(
            String id, InventoryResponse.MedicineRef medicine, String batchNumber, Instant expiryDate,
            int quantity, int reservedQuantity, int available, BigDecimal purchaseRate, BigDecimal mrp,
            String location, InventoryResponse.ShelfRef shelf, int minimumStock, int reorderLevel, String status,
            Instant createdAt, Instant updatedAt,
            String tier, int daysToExpiry, WasteRisk wasteRisk) {

        public static ExpiryAlert of(InventoryResponse b, String tier, int daysToExpiry, WasteRisk wasteRisk) {
            return new ExpiryAlert(b.id(), b.medicine(), b.batchNumber(), b.expiryDate(), b.quantity(),
                    b.reservedQuantity(), b.available(), b.purchaseRate(), b.mrp(), b.location(), b.shelf(),
                    b.minimumStock(), b.reorderLevel(), b.status(), b.createdAt(), b.updatedAt(),
                    tier, daysToExpiry, wasteRisk);
        }
    }

    /** Flattened — see {@link ExpiryAlert}. tier: OUT_OF_STOCK | REORDER (&lt;=reorderLevel) | LOW (&lt;=minimumStock) */
    public record LowStockAlert(
            String id, InventoryResponse.MedicineRef medicine, String batchNumber, Instant expiryDate,
            int quantity, int reservedQuantity, int available, BigDecimal purchaseRate, BigDecimal mrp,
            String location, InventoryResponse.ShelfRef shelf, int minimumStock, int reorderLevel, String status,
            Instant createdAt, Instant updatedAt,
            String tier, ReorderInsight reorder) {

        public static LowStockAlert of(InventoryResponse b, String tier, ReorderInsight reorder) {
            return new LowStockAlert(b.id(), b.medicine(), b.batchNumber(), b.expiryDate(), b.quantity(),
                    b.reservedQuantity(), b.available(), b.purchaseRate(), b.mrp(), b.location(), b.shelf(),
                    b.minimumStock(), b.reorderLevel(), b.status(), b.createdAt(), b.updatedAt(),
                    tier, reorder);
        }
    }

    /**
     * riskTier: HIGH | MEDIUM | LOW | SAFE | NO_DATA. Always populated — NO_DATA marks a
     * medicine with no sales history in the lookback window rather than the field being
     * omitted, so the frontend never needs to null-check it. See
     * {@code InventoryService#computeWasteRisk}.
     */
    public record WasteRisk(double avgDailySales, int willSellUnits, int atRiskUnits, int potentialLoss, String riskTier) {
    }

    public record ReorderInsight(double avgDailySales, int suggestedQty, int coverDays, int leadTimeDays, boolean hasData) {
    }
}
