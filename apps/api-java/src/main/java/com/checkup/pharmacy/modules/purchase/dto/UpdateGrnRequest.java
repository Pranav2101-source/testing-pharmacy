package com.checkup.pharmacy.modules.purchase.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

/** items is optional (null = leave unchanged); if provided, the service rejects an empty list. */
public record UpdateGrnRequest(
        String supplierInvoiceNo,
        Instant supplierInvoiceDate,
        @Size(max = 1000) String notes,
        @Valid List<GrnItemRequest> items,
        boolean allowNearExpiry
) {
}
