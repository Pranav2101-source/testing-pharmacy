package com.checkup.pharmacy.modules.medicine.dto;

import jakarta.validation.constraints.NotBlank;

import java.math.BigDecimal;

/** PATCH /medicines/{id} — PLATFORM_ADMIN only; edits the shared catalog entry. */
public record UpdateMedicineRequest(
        @NotBlank(message = "Medicine name is required") String name,
        String genericName,
        String manufacturer,
        String composition,
        String category,
        String schedule,
        String hsnCode,
        BigDecimal gstRate,
        String form,
        String strength,
        String unit,
        String packSize
) {
}
