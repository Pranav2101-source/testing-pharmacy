package com.checkup.pharmacy.modules.billing.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record InvoicePageResponse(List<Summary> items, long total, int page, int limit, int totalPages) {

    /** Lighter list-row shape — omits line items/payments, which the detail endpoint provides. */
    public record Summary(String id, String invoiceNumber, String customerName, String customerPhone,
                          String userName, String paymentMode, String paymentStatus, String status,
                          BigDecimal totalAmount, boolean isCancelled, int itemCount, Instant createdAt) {
    }
}
