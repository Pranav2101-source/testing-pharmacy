package com.checkup.pharmacy.modules.migration.dto;

import jakarta.validation.constraints.Size;

public record CreateSessionRequest(@Size(max = 100) String sourceSoftware, @Size(max = 500) String notes) {
}
