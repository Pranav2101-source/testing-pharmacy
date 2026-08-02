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
        @Min(0) @Max(100) BigDecimal discount
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
