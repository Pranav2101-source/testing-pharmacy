package com.checkup.pharmacy.modules.cashclosure.dto;

import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.LocalDate;

public record CreateCashClosureRequest(
        LocalDate closureDate,
        @PositiveOrZero BigDecimal openingCash,
        @PositiveOrZero BigDecimal actualCash,
        @Size(max = 1000) String notes
) {
    public BigDecimal openingCashOrZero() {
        return openingCash == null ? BigDecimal.ZERO : openingCash;
    }

    public BigDecimal actualCashOrZero() {
        return actualCash == null ? BigDecimal.ZERO : actualCash;
    }
}
