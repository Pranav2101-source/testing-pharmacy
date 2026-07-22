package com.checkup.pharmacy.modules.quotation.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

public record QuotationItemRequest(
        @NotBlank String medicineId,
        @NotBlank @Size(max = 200) String medicineName,
        @NotNull @Positive Integer quantity,
        @Positive BigDecimal quotedRate,
        @Positive BigDecimal mrp,
        BigDecimal gstRate,
        @PositiveOrZero BigDecimal discount,
        @Size(max = 200) String notes
) {
    public BigDecimal gstRateOrDefault() {
        return gstRate == null ? BigDecimal.valueOf(12) : gstRate;
    }

    public BigDecimal discountOrZero() {
        return discount == null ? BigDecimal.ZERO : discount;
    }
}
