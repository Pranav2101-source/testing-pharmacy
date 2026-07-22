package com.checkup.pharmacy.modules.stockaudit.dto;

import java.math.BigDecimal;
import java.time.Instant;

public record AuditItemResponse(
        String id,
        InventoryRef inventory,
        int expectedQty,
        Integer countedQty,
        Integer varianceQty,
        String notes
) {
    public record InventoryRef(String id, String batchNumber, Instant expiryDate, int quantity,
                               BigDecimal mrp, MedicineRef medicine) {
    }

    public record MedicineRef(String id, String name, String genericName, String form, String strength) {
    }
}
