package com.checkup.pharmacy.modules.reports.dto;

import java.math.BigDecimal;
import java.time.Instant;

/** @param looseUnits loose pieces left from an opened strip — a batch can appear here with
 *                     {@code quantity == 0} and only this remainder about to expire. */
public record ExpiryItemResponse(String id, int quantity, int looseUnits, Instant expiryDate, String batchNumber,
                                 BigDecimal mrp, MedicineRef medicine) {

    public record MedicineRef(String name) {
    }
}
