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
        List<Batch> batches
) {
    public record BrandRef(String id, String name) {
    }

    public record Batch(
            String id,
            String batchNumber,
            Instant expiryDate,
            int quantity,
            int reservedQuantity,
            BigDecimal mrp,
            BigDecimal purchaseRate,
            String location
    ) {
    }
}
