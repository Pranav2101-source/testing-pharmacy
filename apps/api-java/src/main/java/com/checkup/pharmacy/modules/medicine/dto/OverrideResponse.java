package com.checkup.pharmacy.modules.medicine.dto;

import java.math.BigDecimal;
import java.time.Instant;

/** Matches the frontend's Override shape. Null gstRate/defaultDiscountPct = use catalog value. */
public record OverrideResponse(
        String medicineId,
        BigDecimal gstRate,
        BigDecimal defaultDiscountPct,
        String notes,
        boolean allowLooseSale,
        boolean looseByDefault,
        Instant looseConfirmedAt,
        // This override's own pack size, if set.
        Integer unitsPerPack,
        // The value billing will actually use: this override's unitsPerPack, else the catalogue's.
        Integer effectiveUnitsPerPack
) {
}
