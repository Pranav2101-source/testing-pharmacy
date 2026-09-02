package com.checkup.pharmacy.modules.inventory.dto;

import java.math.BigDecimal;
import java.time.Instant;

public record InventoryResponse(
        String id,
        MedicineRef medicine,
        String batchNumber,
        Instant expiryDate,
        int quantity,
        // Loose pieces from an opened pack (cut-strip selling). 0 for pack-only stock.
        // Total pieces on hand = quantity * medicine.unitsPerPack + looseUnits.
        int looseUnits,
        int reservedQuantity,
        int available,
        BigDecimal purchaseRate,
        BigDecimal mrp,
        String location,
        ShelfRef shelf,
        int minimumStock,
        int reorderLevel,
        String status,
        Instant createdAt,
        Instant updatedAt
) {
    /**
     * isActive, gstRate and hsnCode are required here, not decorative — the
     * billing combobox reads all three off this same object:
     * {@code !batch.medicine.isActive} to refuse selling a discontinued
     * medicine, and {@code batch.medicine.gstRate} to compute the line
     * amount (missing, it silently computes NaN rather than erroring, since
     * `undefined * x` is NaN, not a thrown exception).
     *
     * <p>{@code unitsPerPack} is the EFFECTIVE pack size (this pharmacy's override,
     * else the catalogue's); {@code allowLooseSale} is this pharmacy's opt-in. The
     * POS uses both to offer the Strip/Tab toggle and compute per-piece availability.
     */
    public record MedicineRef(String id, String name, String genericName, String form, String strength, String unit,
                              boolean isActive, java.math.BigDecimal gstRate, String hsnCode,
                              Integer unitsPerPack, String baseUnit, boolean allowLooseSale, boolean looseByDefault) {
    }

    public record ShelfRef(String id, String code, RackRef rack) {
    }

    public record RackRef(String id, String code, String name) {
    }
}
