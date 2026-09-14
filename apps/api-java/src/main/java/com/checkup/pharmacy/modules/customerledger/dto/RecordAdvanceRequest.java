package com.checkup.pharmacy.modules.customerledger.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

/**
 * A deposit taken from a customer against no particular bill.
 *
 * <p>{@code paymentMode} is how the money arrived — CASH, UPI, CARD or WALLET. It is
 * how the deposit reaches the day's drawer figure, so it is required even though the
 * ledger itself would accept a null.
 */
public record RecordAdvanceRequest(
        @NotNull @Positive BigDecimal amount,
        @NotBlank String paymentMode,
        @Size(max = 100) String reference,
        @Size(max = 500) String notes
) {
}
