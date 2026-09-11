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
     *
     * <p>{@code schedule} and {@code packSize} are the catalogue's raw values (not
     * pharmacy-specific) — added so the Inventory screen can offer its own "enable
     * loose selling" entry point without a second round trip: {@code schedule} is
     * required to keep blocking Schedule X the same way the Medicines page does,
     * and {@code packSize} (free text like "10s") is what a units-per-pack guess is
     * parsed from when the catalogue has no structured {@code unitsPerPack}.
     *
     * <p>{@code packSizeConfidence} — "VERIFIED" | "UNVERIFIED" | "DISPUTED", or null — is the
     * trust state of the EFFECTIVE {@code unitsPerPack} above, the number this pharmacy bills
     * by (see {@code PharmacyMedicineOverride.effectivePackSizeConfidence}): VERIFIED when a
     * pharmacist here confirmed exactly that number, else the catalogue's own state when the
     * number is the catalogue's. Nothing here writes back to the catalogue, so one pharmacy's
     * check never vouches for a shared value. Null for a countable medicine and for one with no
     * pack size on record.
     */
    public record MedicineRef(String id, String name, String genericName, String form, String strength, String unit,
                              boolean isActive, java.math.BigDecimal gstRate, String hsnCode,
                              Integer unitsPerPack, String baseUnit, boolean allowLooseSale, boolean looseByDefault,
                              String schedule, String packSize, String packSizeConfidence) {
    }

    public record ShelfRef(String id, String code, RackRef rack) {
    }

    public record RackRef(String id, String code, String name) {
    }
}
