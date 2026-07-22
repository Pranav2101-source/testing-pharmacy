package com.checkup.pharmacy.modules.inventory.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;

public record AddStockRequest(
        @NotBlank String medicineId,
        @NotBlank @Size(max = 50) String batchNumber,
        @NotNull Instant expiryDate,
        @NotNull @Positive Integer quantity,
        @NotNull @Positive BigDecimal purchaseRate,
        @NotNull @Positive BigDecimal mrp,
        @Size(max = 100) String location,
        String shelfId,
        @Min(0) Integer minimumStock,
        @Min(0) Integer reorderLevel
) {
    @AssertTrue(message = "Purchase rate exceeds MRP — verify before saving")
    public boolean isRateWithinMrp() {
        return purchaseRate == null || mrp == null || purchaseRate.compareTo(mrp) <= 0;
    }

    public int minimumStockOrDefault() {
        return minimumStock == null ? 10 : minimumStock;
    }

    public int reorderLevelOrDefault() {
        return reorderLevel == null ? 5 : reorderLevel;
    }
}
