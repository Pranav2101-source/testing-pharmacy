package com.checkup.pharmacy.modules.billing.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record SalesReturnResponse(
        String id,
        String returnNumber,
        InvoiceRef invoice,
        String reason,
        UserRef user,
        CustomerRef customer,
        BigDecimal subtotal,
        BigDecimal discountAmount,
        BigDecimal taxableAmount,
        BigDecimal cgst,
        BigDecimal sgst,
        BigDecimal igst,
        BigDecimal totalGst,
        BigDecimal totalAmount,
        List<Item> items,
        Instant createdAt
) {
    public record InvoiceRef(String id, String invoiceNumber) {
    }

    public record UserRef(String id, String name) {
    }

    public record CustomerRef(String id, String name, String phone) {
    }

    public record Item(String id, String invoiceItemId, String inventoryId, String medicineName, String hsnCode,
                       String batchNumber, Instant expiryDate, int quantity, BigDecimal mrp, BigDecimal rate,
                       BigDecimal discount, BigDecimal gstRate, BigDecimal cgst, BigDecimal sgst, BigDecimal igst,
                       BigDecimal taxableAmount, BigDecimal amount, String disposition) {
    }
}
