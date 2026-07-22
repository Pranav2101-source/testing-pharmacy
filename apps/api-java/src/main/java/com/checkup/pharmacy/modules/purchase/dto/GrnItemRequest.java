package com.checkup.pharmacy.modules.purchase.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;

public record GrnItemRequest(
        @NotBlank String medicineId,
        @NotBlank String medicineName,
        @NotBlank @Size(max = 50) String batchNumber,
        @NotNull Instant expiryDate,
        @PositiveOrZero Integer orderedQty,
        @NotNull @Positive Integer receivedQty,
        @PositiveOrZero Integer freeQty,
        String purchaseUnit,
        @Positive Integer conversionFactor,
        @NotNull @Positive BigDecimal purchaseRate,
        @NotNull @Positive BigDecimal mrp,
        @Min(0) BigDecimal discount,
        @NotNull BigDecimal gstRate
) {
    @AssertTrue(message = "MRP must be greater than or equal to purchase rate")
    public boolean isMrpAboveRate() {
        return mrp == null || purchaseRate == null || mrp.compareTo(purchaseRate) >= 0;
    }

    public int freeQtyOrZero() {
        return freeQty == null ? 0 : freeQty;
    }

    public String purchaseUnitOrDefault() {
        return (purchaseUnit == null || purchaseUnit.isBlank()) ? "UNIT" : purchaseUnit;
    }

    public int conversionFactorOrDefault() {
        return conversionFactor == null ? 1 : conversionFactor;
    }

    public BigDecimal discountOrZero() {
        return discount == null ? BigDecimal.ZERO : discount;
    }
}
