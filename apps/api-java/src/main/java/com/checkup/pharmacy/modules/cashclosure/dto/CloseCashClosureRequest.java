package com.checkup.pharmacy.modules.cashclosure.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

public record CloseCashClosureRequest(
        @NotNull @PositiveOrZero BigDecimal actualCash,
        @Size(max = 1000) String notes
) {
}
