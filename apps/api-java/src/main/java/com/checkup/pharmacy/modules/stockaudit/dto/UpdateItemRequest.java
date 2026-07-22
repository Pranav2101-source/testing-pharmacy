package com.checkup.pharmacy.modules.stockaudit.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

/** At least one of countedQty/notes must be present — enforced in the service, not here (both are independently optional). */
public record UpdateItemRequest(
        @Min(0) Integer countedQty,
        @Size(max = 500) String notes
) {
}
