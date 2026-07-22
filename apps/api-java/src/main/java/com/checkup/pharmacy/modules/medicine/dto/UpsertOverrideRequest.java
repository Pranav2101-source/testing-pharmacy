package com.checkup.pharmacy.modules.medicine.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;

import java.math.BigDecimal;

public record UpsertOverrideRequest(
        BigDecimal gstRate,
        @DecimalMin(value = "0", message = "Discount must be between 0 and 100")
        @DecimalMax(value = "100", message = "Discount must be between 0 and 100")
        BigDecimal defaultDiscountPct,
        String notes
) {
}
