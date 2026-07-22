package com.checkup.pharmacy.modules.cashclosure.dto;

import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

public record UpdateCashClosureRequest(
        @PositiveOrZero BigDecimal openingCash,
        @PositiveOrZero BigDecimal actualCash,
        @Size(max = 1000) String notes
) {
}
