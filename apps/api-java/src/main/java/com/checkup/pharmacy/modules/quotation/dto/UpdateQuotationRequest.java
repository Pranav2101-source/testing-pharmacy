package com.checkup.pharmacy.modules.quotation.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

/** items is optional (null = leave unchanged); if provided, the service rejects an empty list. */
public record UpdateQuotationRequest(
        Instant validUntil,
        @Size(max = 1000) String notes,
        @Valid List<QuotationItemRequest> items
) {
}
