package com.checkup.pharmacy.modules.purchase.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record PurchaseOrderResponse(
        String id,
        String orderNumber,
        SupplierRef supplier,
        String invoiceNo,
        String status,
        String approvalStatus,
        String approvedBy,
        Instant approvedAt,
        String rejectionReason,
        BigDecimal subtotal,
        BigDecimal totalGst,
        BigDecimal totalAmount,
        String notes,
        Instant expectedDate,
        Instant orderedAt,
        Instant receivedAt,
        List<ItemSnapshot> items,
        int itemCount,
        List<GrnRef> grns,
        String sourceUploadId
) {
    public record SupplierRef(String id, String name, String phone, String email) {
    }

    public record ItemSnapshot(String medicineId, String medicineName, String batchNumber, String expiryDate,
                               int quantity, BigDecimal purchaseRate, BigDecimal mrp, BigDecimal gstRate,
                               BigDecimal cgst, BigDecimal sgst, BigDecimal amount) {
    }

    public record GrnRef(String id, String grnNumber, String status, Instant createdAt, BigDecimal totalAmount) {
    }
}
