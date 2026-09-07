package com.checkup.pharmacy.modules.dispensing.dto;

import jakarta.validation.constraints.NotBlank;

/** Body for {@code PUT /api/v1/dispensing/strategy}. */
public record UpdateDispensingStrategyRequest(
        @NotBlank(message = "strategy is required (LILA_FEFO or LIFA)")
        String strategy
) {
}
