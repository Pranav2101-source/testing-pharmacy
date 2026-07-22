package com.checkup.pharmacy.modules.inventory.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import java.util.List;

public record ReserveStockRequest(
        @NotBlank String sessionId,
        @NotEmpty @Valid List<Item> items
) {
    public record Item(
            @NotBlank String inventoryId,
            @NotNull @Positive Integer quantity
    ) {
    }
}
