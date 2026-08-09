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
        /*
         * The billing session whose stock reservations this sale consumes.
         *
         * A till reserves stock while the cart is being built (POST /inventory/reserve)
         * and those units show up in Inventory.reservedQuantity. Without this field the
         * sale had no way to tell its OWN hold apart from another counter's, so it
         * counted its own reservation against itself and refused any cart holding more
         * than half a batch — blaming "another billing session" that was the caller.
         *
         * Defaults to idempotencyKey, which is what the web client already uses as its
         * session id, so an older client keeps working.
         */
        String sessionId,
        @NotEmpty @Valid List<InvoiceItemRequest> items
) {

    /**
     * Null when this sale is not associated with any reservation session.
     *
     * <p>There is deliberately NO shorter convenience constructor on this record. One
     * existed briefly so the positional call sites in the tests would not have to
     * change, and it was a trap: a record's JSON binding goes through its canonical
     * constructor, so if anything ever caused Jackson to pick a shorter overload
     * instead, {@code sessionId} would arrive null on every request, the stock
     * reservation a till holds would never be released, and nothing would fail — not
     * the build, not a test, not a log line. One arity, no ambiguity to get wrong.
     */
    public String reservationSessionId() {
        if (sessionId != null && !sessionId.isBlank()) return sessionId;
        return idempotencyKey != null && !idempotencyKey.isBlank() ? idempotencyKey : null;
    }

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
