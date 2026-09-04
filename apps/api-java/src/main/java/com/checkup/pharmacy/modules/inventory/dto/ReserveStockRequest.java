package com.checkup.pharmacy.modules.inventory.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;

import java.util.List;

public record ReserveStockRequest(
        @NotBlank String sessionId,
        @NotEmpty @Valid List<Item> items
) {
    public record Item(
            @NotBlank String inventoryId,
            @NotNull @Positive Integer quantity,
            /**
             * {@code LOOSE} — {@code quantity} is individual pieces; the reservation is
             * rounded up to whole packs so it lines up with how billing and
             * {@code Inventory.reservedQuantity} count. {@code PACK}/null — quantity is
             * packs, as it has always been.
             */
            @Pattern(regexp = "(?i)PACK|LOOSE", message = "saleUnit must be PACK or LOOSE") String saleUnit
    ) {
        /** Back-compat for the many positional call sites that predate loose selling. */
        public Item(String inventoryId, Integer quantity) {
            this(inventoryId, quantity, null);
        }

        public boolean isLoose() {
            return "LOOSE".equalsIgnoreCase(saleUnit);
        }
    }
}
