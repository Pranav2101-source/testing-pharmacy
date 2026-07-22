package com.checkup.pharmacy.modules.billing.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;

public record AddPaymentRequest(
        @NotNull @Positive BigDecimal amount,
        @NotBlank String paymentMode,
        @Size(max = 100) String reference,
        @Size(max = 500) String notes,
        Instant paidAt
) {
}
