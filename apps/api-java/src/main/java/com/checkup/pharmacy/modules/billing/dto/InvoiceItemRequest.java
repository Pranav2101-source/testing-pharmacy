package com.checkup.pharmacy.modules.billing.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

import java.math.BigDecimal;

public record InvoiceItemRequest(
        @NotBlank String inventoryId,
        @NotNull @Positive Integer quantity,
        /**
         * Scheme quantity handed over free with this line (10+1, buy-100-get-10).
         *
         * <p>Not charged, but DOES come off the shelf — the batch is decremented by
         * {@code quantity + freeQty} and the stock check is made against the total.
         * Optional; absent means none.
         */
        @PositiveOrZero Integer freeQty,
        @Min(0) @Max(100) BigDecimal discount,
        /**
         * The prescribed line this sale fulfils, when the cashier said which one.
         *
         * <p>Optional, and null on every counter sale. It exists for one case that cannot be
         * inferred: a SUBSTITUTION. Dispensing is otherwise attributed by matching the sold
         * medicine to a prescribed one, which by definition cannot find the line when a
         * different product was handed over — so without this the prescribed line would stay
         * unfulfilled and the clinic would be told the patient collected nothing.
         */
        String prescriptionItemId
) {
    public BigDecimal discountOrZero() {
        return discount == null ? BigDecimal.ZERO : discount;
    }

    public int freeQtyOrZero() {
        return freeQty == null ? 0 : freeQty;
    }

    /** What actually leaves the shelf for this line. */
    public int totalDispensedQty() {
        return quantity + freeQtyOrZero();
    }
}
