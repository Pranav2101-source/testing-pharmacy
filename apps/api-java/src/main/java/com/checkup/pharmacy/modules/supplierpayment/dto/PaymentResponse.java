package com.checkup.pharmacy.modules.supplierpayment.dto;

import java.math.BigDecimal;
import java.time.Instant;

public record PaymentResponse(
        String id,
        String paymentNumber,
        SupplierRef supplier,
        GrnRef grn,
        BigDecimal amount,
        String paymentMode,
        String reference,
        String notes,
        Instant paidAt,
        Instant createdAt
) {
    public record SupplierRef(String id, String name) {
    }

    public record GrnRef(String id, String grnNumber, BigDecimal totalAmount) {
    }
}
