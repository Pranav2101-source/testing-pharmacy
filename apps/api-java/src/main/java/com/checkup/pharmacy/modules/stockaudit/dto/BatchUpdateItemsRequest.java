package com.checkup.pharmacy.modules.stockaudit.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

import java.util.List;

public record BatchUpdateItemsRequest(
        @Size(min = 1, max = 500) @Valid List<Item> items
) {
    public record Item(
            @NotBlank String itemId,
            @NotNull @Min(0) Integer countedQty,
            /** Loose remainder counted, in pieces — optional, and never defaulted to zero when absent. */
            @Min(0) Integer countedLooseUnits
    ) {
    }
}
