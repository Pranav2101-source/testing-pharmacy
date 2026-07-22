package com.checkup.pharmacy.modules.purchase.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * A draft PO line — batch/expiry are optional (filled in later when goods arrive
 * via GRN); only medicine and quantity are required to raise an order.
 */
public record PurchaseOrderItemRequest(
        @NotBlank String medicineId,
        @NotBlank String medicineName,
        @Size(max = 50) String batchNumber,
        Instant expiryDate,
        @NotNull @Positive Integer quantity,
        @PositiveOrZero BigDecimal purchaseRate,
        @PositiveOrZero BigDecimal mrp,
        BigDecimal gstRate
) {
    public BigDecimal purchaseRateOrZero() {
        return purchaseRate == null ? BigDecimal.ZERO : purchaseRate;
    }

    public BigDecimal mrpOrZero() {
        return mrp == null ? BigDecimal.ZERO : mrp;
    }

    public BigDecimal gstRateOrDefault() {
        return gstRate == null ? BigDecimal.valueOf(12) : gstRate;
    }
}
