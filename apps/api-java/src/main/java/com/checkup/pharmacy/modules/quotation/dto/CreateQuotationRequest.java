package com.checkup.pharmacy.modules.quotation.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

public record CreateQuotationRequest(
        @NotBlank String supplierId,
        Instant validUntil,
        @Size(max = 1000) String notes,
        @NotEmpty @Valid List<QuotationItemRequest> items
) {
}
