package com.checkup.pharmacy.modules.quotation.dto;

import jakarta.validation.constraints.Size;

public record ConvertToPoRequest(@Size(max = 500) String notes) {
}
