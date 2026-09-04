package com.checkup.pharmacy.modules.stockaudit.dto;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * @param expectedLooseUnits loose (cut-strip) remainder snapshotted at session creation
 * @param countedLooseUnits  what staff physically counted, in pieces — null until entered,
 *                           and null is never "counted zero" (see StockAuditItem.recordCount)
 * @param varianceLooseUnits countedLooseUnits - expectedLooseUnits, null until counted
 */
public record AuditItemResponse(
        String id,
        InventoryRef inventory,
        int expectedQty,
        Integer countedQty,
        Integer varianceQty,
        int expectedLooseUnits,
        Integer countedLooseUnits,
        Integer varianceLooseUnits,
        String notes
) {
    public record InventoryRef(String id, String batchNumber, Instant expiryDate, int quantity,
                               BigDecimal mrp, MedicineRef medicine) {
    }

    /**
     * {@code unitsPerPack} is the EFFECTIVE pack size the POS bills at — this pharmacy's
     * {@code pharmacy_medicine_overrides.unitsPerPack} when it has set one, else the
     * catalogue's — so the count screen's loose-count box and its variance-₹ preview agree
     * with the recorded audit P&L, which resolves the pack size the same way. {@code baseUnit}
     * is resolved through {@link com.checkup.pharmacy.common.util.BaseUnits} (stored value, or
     * inferred from {@code form}), never a bare null for a medicine that has a form.
     */
    public record MedicineRef(String id, String name, String genericName, String form, String strength,
                              Integer unitsPerPack, String baseUnit) {
    }
}
