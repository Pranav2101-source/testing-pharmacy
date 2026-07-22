package com.checkup.pharmacy.modules.medicine.dto;

import java.math.BigDecimal;

/** Matches the frontend's Override shape. Null gstRate/defaultDiscountPct = use catalog value. */
public record OverrideResponse(
        String medicineId,
        BigDecimal gstRate,
        BigDecimal defaultDiscountPct,
        String notes
) {
}
