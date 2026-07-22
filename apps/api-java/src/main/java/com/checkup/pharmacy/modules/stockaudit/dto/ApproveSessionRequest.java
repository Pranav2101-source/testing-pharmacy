package com.checkup.pharmacy.modules.stockaudit.dto;

import jakarta.validation.constraints.Size;

public record ApproveSessionRequest(@Size(max = 500) String notes) {
}
