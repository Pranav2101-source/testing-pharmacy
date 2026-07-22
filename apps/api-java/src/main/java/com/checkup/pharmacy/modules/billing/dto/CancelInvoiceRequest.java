package com.checkup.pharmacy.modules.billing.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CancelInvoiceRequest(
        @NotBlank @Size(max = 500) String reason
) {
}
