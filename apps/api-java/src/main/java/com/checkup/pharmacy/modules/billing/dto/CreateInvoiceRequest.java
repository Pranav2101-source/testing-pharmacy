package com.checkup.pharmacy.modules.billing.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.util.List;

public record CreateInvoiceRequest(
        String customerId,
        String doctorId,
        @Size(max = 200) String doctorName,
        String prescriptionId,
        String paymentMode,
        String paymentStatus,
        Boolean isInterstate,
        @Size(max = 1000) String notes,
        @Size(max = 1000) String deliveryNotes,
        /*
         * Bounded to match the per-line discount on InvoiceItemRequest, which was
         * already @Min(0) @Max(100). Unbounded, a mistyped 100-for-10 produced a
         * zero-rupee invoice while the stock still left the shelf (preRound clamps at
         * zero), and a negative value silently INCREASED the total.
         */
        @DecimalMin("0") @DecimalMax("100") BigDecimal billDiscountPct,
        /*
         * Non-negative: a negative "extra charge" is a discount wearing a different
         * name, and would route around the 0-100 cap on billDiscountPct above.
         */
        @DecimalMin("0") BigDecimal extraCharges,
        /*
         * Deliberately unbounded and signed — this is the round-off/goodwill tweak and
         * is legitimately negative. It is not left unguarded: BillingService rejects
         * any combination of discount and adjustment that drives the bill below zero.
         */
        BigDecimal adjustmentAmount,
        String idempotencyKey,
        @NotEmpty @Valid List<InvoiceItemRequest> items
) {
    public String paymentModeOrDefault() {
        return paymentMode == null || paymentMode.isBlank() ? "CASH" : paymentMode;
    }

    public String paymentStatusOrDefault() {
        return paymentStatus == null || paymentStatus.isBlank() ? "PAID" : paymentStatus;
    }

    public boolean isInterstateOrDefault() {
        return isInterstate != null && isInterstate;
    }

    public BigDecimal billDiscountPctOrZero() {
        return billDiscountPct == null ? BigDecimal.ZERO : billDiscountPct;
    }

    public BigDecimal extraChargesOrZero() {
        return extraCharges == null ? BigDecimal.ZERO : extraCharges;
    }

    public BigDecimal adjustmentAmountOrZero() {
        return adjustmentAmount == null ? BigDecimal.ZERO : adjustmentAmount;
    }
}
