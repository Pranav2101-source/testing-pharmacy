package com.checkup.pharmacy.modules.location.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record CreateShelfRequest(
        @NotBlank(message = "Rack is required") String rackId,
        @NotBlank(message = "Code is required") String code,
        @NotNull @Min(value = 1, message = "Level must be a positive number") Integer level,
        String description
) {
}
