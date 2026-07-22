package com.checkup.pharmacy.modules.medicine.dto;

import java.math.BigDecimal;

/** Matches the frontend's Medicine shape exactly. */
public record MedicineResponse(
        String id,
        String name,
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
        String packSize,
        boolean isActive
) {
}
