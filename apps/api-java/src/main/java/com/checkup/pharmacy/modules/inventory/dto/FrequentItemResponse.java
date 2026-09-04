package com.checkup.pharmacy.modules.inventory.dto;

import java.math.BigDecimal;
import java.time.Instant;

/** "Quick Add" — the pharmacy's most-frequently-billed medicines over the trailing 30 days,
 *  each resolved to its current best (FEFO) sellable batch. */
public record FrequentItemResponse(
        String id,
        String batchNumber,
        Instant expiryDate,
        BigDecimal mrp,
        int quantity,
        int looseUnits,
        int reservedQuantity,
        String location,
        InventoryResponse.ShelfRef shelf,
        long freq,
        MedicineRef medicine
) {
    /** {@code unitsPerPack} is the effective pack size, {@code allowLooseSale} this pharmacy's opt-in. */
    public record MedicineRef(String name, String genericName, String hsnCode, BigDecimal gstRate,
                              boolean isActive, String schedule, String packSize,
                              Integer unitsPerPack, String baseUnit, boolean allowLooseSale, boolean looseByDefault) {
    }
}
