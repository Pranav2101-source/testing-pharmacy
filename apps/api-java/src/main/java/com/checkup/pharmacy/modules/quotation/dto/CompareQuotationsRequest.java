package com.checkup.pharmacy.modules.quotation.dto;

import jakarta.validation.constraints.Size;

import java.util.List;

public record CompareQuotationsRequest(
        @Size(min = 2, max = 10) List<String> quotationIds
) {
}
