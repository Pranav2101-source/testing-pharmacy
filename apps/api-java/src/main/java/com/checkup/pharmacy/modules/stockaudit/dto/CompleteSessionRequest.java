package com.checkup.pharmacy.modules.stockaudit.dto;

import jakarta.validation.constraints.Size;

public record CompleteSessionRequest(@Size(max = 500) String notes) {
}
