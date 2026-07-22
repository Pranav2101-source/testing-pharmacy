package com.checkup.pharmacy.modules.supplierreturn.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import java.math.BigDecimal;
import java.time.Instant;

public record SupplierReturnItemRequest(
        @NotBlank String inventoryId,
        @NotBlank String medicineId,
        @NotBlank String medicineName,
        @NotBlank String batchNumber,
        @NotNull Instant expiryDate,
        @NotNull @Positive Integer quantity,
        @NotNull @Positive BigDecimal purchaseRate,
        BigDecimal gstRate,
        String reason
) {
    public BigDecimal gstRateOrDefault() {
        return gstRate == null ? BigDecimal.valueOf(12) : gstRate;
    }

    public String reasonOrDefault() {
        return (reason == null || reason.isBlank()) ? "DAMAGED" : reason;
    }
}
