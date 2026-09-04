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
        boolean isActive,
        // ── Loose dispensing ────────────────────────────────────────────────
        // unitsPerPack / baseUnit are catalogue-global. allowLooseSale is
        // per-pharmacy and only populated on the POS-facing paths (quick search,
        // barcode lookup); it is false on the global catalogue views.
        Integer unitsPerPack,
        String baseUnit,
        boolean allowLooseSale,
        // New POS lines for this medicine start as loose (per-pharmacy; POS paths only).
        boolean looseByDefault
) {
}
