package com.checkup.pharmacy.modules.reports.dto;

import java.math.BigDecimal;
import java.time.Instant;

public record ExpiryItemResponse(String id, int quantity, Instant expiryDate, String batchNumber, BigDecimal mrp,
                                 MedicineRef medicine) {

    public record MedicineRef(String name) {
    }
}
