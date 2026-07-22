package com.checkup.pharmacy.modules.billing.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

public record CreateReturnRequest(
        @NotBlank @Size(max = 500) String reason,
        @NotEmpty @Valid List<ReturnItemRequest> items,
        String idempotencyKey
) {
}
