package com.checkup.pharmacy.modules.suppliercreditnote.dto;

import java.math.BigDecimal;
import java.time.Instant;

public record CreditNoteResponse(
        String id,
        String creditNoteNumber,
        SupplierRef supplier,
        SupplierReturnRef supplierReturn,
        BigDecimal amount,
        String status,
        String reference,
        String notes,
        Instant issuedAt,
        Instant createdAt
) {
    public record SupplierRef(String id, String name, String phone) {
    }

    public record SupplierReturnRef(String id, String returnNumber, BigDecimal totalAmount) {
    }
}
