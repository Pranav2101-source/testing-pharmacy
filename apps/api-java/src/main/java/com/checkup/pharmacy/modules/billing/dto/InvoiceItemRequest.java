package com.checkup.pharmacy.modules.billing.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import java.math.BigDecimal;

public record InvoiceItemRequest(
        @NotBlank String inventoryId,
        @NotNull @Positive Integer quantity,
        @Min(0) @Max(100) BigDecimal discount
) {
    public BigDecimal discountOrZero() {
        return discount == null ? BigDecimal.ZERO : discount;
    }
}
