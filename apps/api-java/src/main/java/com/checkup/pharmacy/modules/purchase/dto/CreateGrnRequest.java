package com.checkup.pharmacy.modules.purchase.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

public record CreateGrnRequest(
        @NotBlank String supplierId,
        String purchaseOrderId,
        String supplierInvoiceNo,
        Instant supplierInvoiceDate,
        @Size(max = 1000) String notes,
        @NotEmpty @Valid List<GrnItemRequest> items,
        boolean allowNearExpiry,
        String sourceUploadId
) {
}
