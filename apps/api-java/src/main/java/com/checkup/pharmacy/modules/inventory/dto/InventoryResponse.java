package com.checkup.pharmacy.modules.inventory.dto;

import java.math.BigDecimal;
import java.time.Instant;

public record InventoryResponse(
        String id,
        MedicineRef medicine,
        String batchNumber,
        Instant expiryDate,
        int quantity,
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
     */
    public record MedicineRef(String id, String name, String genericName, String form, String strength, String unit,
                              boolean isActive, java.math.BigDecimal gstRate, String hsnCode) {
    }

    public record ShelfRef(String id, String code, RackRef rack) {
    }

    public record RackRef(String id, String code, String name) {
    }
}
