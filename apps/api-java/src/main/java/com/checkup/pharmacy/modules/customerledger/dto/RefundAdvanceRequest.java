package com.checkup.pharmacy.modules.customerledger.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

/** Advance handed back to the customer. Refusing to exceed what is held is the ledger's job. */
public record RefundAdvanceRequest(
        @NotNull @Positive BigDecimal amount,
        @NotBlank String paymentMode,
        @Size(max = 500) String notes
) {
}
