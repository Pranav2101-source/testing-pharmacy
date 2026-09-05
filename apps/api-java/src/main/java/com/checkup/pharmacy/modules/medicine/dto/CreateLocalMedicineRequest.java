package com.checkup.pharmacy.modules.medicine.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;

/**
 * "Save as Local Medicine" — creates a pharmacy-scoped medicine identity
 * without ever touching the shared global catalog. Used both by the GRN quick-add
 * flow (replacing the old inline "+ Add to catalogue") and directly, when a
 * pharmacist wants a local product on hand before any GRN references it.
 */
public record CreateLocalMedicineRequest(
        @NotBlank String name,
        String manufacturer,
        String genericName,
        String strength,
        String form,
        String unit,
        String hsnCode,
        @NotNull BigDecimal gstRate,
        String schedule
) {
}
