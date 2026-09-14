package com.checkup.pharmacy.modules.billing.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

/**
 * One way a single bill was settled — Rs.600 by UPI, Rs.400 in cash, and so on.
 *
 * <p>A CREDIT tender is the exception that makes the rest of the model work: it records
 * money deliberately NOT received, the portion put on the customer's account. Keeping it
 * in the same list is what lets the invariant be "the tenders account for every rupee of
 * the bill" rather than "...every rupee that happened to arrive", so the unpaid remainder
 * can never be an unstated leftover. Only non-CREDIT tenders become {@code invoice_payments}
 * rows, because only they moved money.
 */
public record TenderRequest(
        @NotBlank String paymentMode,
        @NotNull @Positive BigDecimal amount,
        /** UPI transaction id, card approval code, cheque number — whatever proves this leg. */
        @Size(max = 100) String reference
) {
}
