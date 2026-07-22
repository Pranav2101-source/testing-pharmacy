package com.checkup.pharmacy.modules.medicine.dto;

import jakarta.validation.constraints.Size;

/**
 * Body for {@code PATCH /medicines/{id}/classification} — a narrow mutation of the
 * shared catalog: only the free-text {@code category} (product type) and {@code unit}
 * (packaging) fields. Both are optional but the frontend's ClassifyModal always sends
 * both; each is trimmed and an empty value stored as null.
 */
public record SetClassificationRequest(
        @Size(max = 100, message = "Category cannot exceed 100 characters") String category,
        @Size(max = 50, message = "Packaging cannot exceed 50 characters") String unit
) {
}
