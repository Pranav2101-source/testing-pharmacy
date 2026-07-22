package com.checkup.pharmacy.modules.quotation.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record QuotationResponse(
        String id,
        String quotationNumber,
        SupplierRef supplier,
        String status,
        Instant validUntil,
        String notes,
        List<Item> items,
        int itemCount,
        Instant createdAt,
        Instant updatedAt
) {
    public record SupplierRef(String id, String name, String phone, String email) {
    }

    public record Item(String id, String medicineId, String medicineName, int quantity, BigDecimal quotedRate,
                       BigDecimal mrp, BigDecimal gstRate, BigDecimal discount, String notes) {
    }
}
