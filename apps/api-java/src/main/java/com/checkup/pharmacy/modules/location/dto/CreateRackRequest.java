package com.checkup.pharmacy.modules.location.dto;

import jakarta.validation.constraints.NotBlank;

public record CreateRackRequest(
        @NotBlank(message = "Code is required") String code,
        @NotBlank(message = "Name is required") String name,
        String aisle
) {
}
