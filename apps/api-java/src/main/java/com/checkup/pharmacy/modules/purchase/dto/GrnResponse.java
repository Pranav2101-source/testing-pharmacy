package com.checkup.pharmacy.modules.purchase.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record GrnResponse(
        String id,
        String grnNumber,
        SupplierRef supplier,
        PurchaseOrderRef purchaseOrder,
        String supplierInvoiceNo,
        Instant supplierInvoiceDate,
        String status,
        String notes,
        BigDecimal subtotal,
        BigDecimal totalGst,
        BigDecimal totalAmount,
        Instant confirmedAt,
        Instant paymentDueDate,
        List<Item> items,
        String warning,
        Instant createdAt,
        String sourceUploadId
) {
    public record SupplierRef(String id, String name, String phone, Integer creditDays) {
    }

    public record PurchaseOrderRef(String id, String orderNumber) {
    }

    public record Item(String id, String medicineId, String medicineName, String batchNumber, Instant expiryDate,
                       Integer orderedQty, int receivedQty, int freeQty, String purchaseUnit, int conversionFactor,
                       BigDecimal purchaseRate, BigDecimal mrp, BigDecimal discount, BigDecimal gstRate,
                       BigDecimal cgst, BigDecimal sgst, BigDecimal amount) {
    }
}
