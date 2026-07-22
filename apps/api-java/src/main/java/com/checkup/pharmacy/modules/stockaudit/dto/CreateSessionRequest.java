package com.checkup.pharmacy.modules.stockaudit.dto;

import jakarta.validation.constraints.Size;

public record CreateSessionRequest(@Size(max = 500) String notes) {
}
