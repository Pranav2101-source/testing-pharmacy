package com.checkup.pharmacy.modules.location.dto;

import jakarta.validation.constraints.Min;

/** PATCH /locations/shelves/{id} — every field optional; a null field is left unchanged. */
public record UpdateShelfRequest(
        String code,
        @Min(value = 1, message = "Level must be a positive number") Integer level,
        String description,
        Boolean isActive
) {
}
