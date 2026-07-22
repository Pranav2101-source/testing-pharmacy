package com.checkup.pharmacy.modules.billing.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

public record ReturnItemRequest(
        @NotBlank String invoiceItemId,
        @NotNull @Positive Integer quantity,
        String disposition
) {
    public String dispositionOrDefault() {
        return disposition == null || disposition.isBlank() ? "RESTOCK" : disposition;
    }
}
