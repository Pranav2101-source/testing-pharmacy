package com.checkup.pharmacy.modules.purchase.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record ApprovePurchaseOrderRequest(
        @NotNull Boolean approved,
        @Size(max = 500) String rejectionReason
) {
}
