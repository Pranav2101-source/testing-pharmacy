package com.checkup.pharmacy.modules.medicine.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * One generic-substitution alternative for the billing POS "Alternatives" drawer —
 * a same-generic medicine plus the caller pharmacy's own live stock for it. Matches
 * the shared `AlternativeResult` type (`packages/types/src/medicine.ts`).
 */
public record AlternativeResponse(
        String id,
        String name,
        String manufacturer,
        String genericName,
        String strength,
        String form,
        String packSize,
        String hsnCode,
        BigDecimal gstRate,
        String schedule,
        BrandRef brand,
        int totalStock,
        BigDecimal mrp,
        BigDecimal margin,
        String stockStatus,
        // Effective pack size + this pharmacy's loose opt-in, so a substitute can be
        // added to the cart as a loose line straight from the drawer.
        Integer unitsPerPack,
        String baseUnit,
        /**
         * {@code Medicine.unit} — the catalogue's packaging word ("Strip", "Bottle", "Tube").
         * Carried so a substitute added straight from the drawer labels its cart row the same
         * way a prescription-sourced row does (see {@code DispensingPlan.Allocation#unit});
         * without it the cart falls back to {@code baseUnit} alone and calls a bottle a strip.
         */
        String unit,
        boolean allowLooseSale,
        boolean looseByDefault,
        List<Batch> batches
) {
    public record BrandRef(String id, String name) {
    }

    public record Batch(
            String id,
            String batchNumber,
            Instant expiryDate,
            int quantity,
            int looseUnits,
            int reservedQuantity,
            BigDecimal mrp,
            BigDecimal purchaseRate,
            String location
    ) {
    }
}
