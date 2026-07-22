package com.checkup.pharmacy.modules.purchase.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

public record CreatePurchaseOrderRequest(
        @NotBlank String supplierId,
        String invoiceNo,
        @Size(max = 1000) String notes,
        Instant expectedDate,
        @NotEmpty @Valid List<PurchaseOrderItemRequest> items,
        String sourceUploadId
) {
}
