package com.checkup.pharmacy.modules.supplierreturn.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record SupplierReturnResponse(
        String id,
        String returnNumber,
        SupplierRef supplier,
        String debitNoteNo,
        String status,
        String notes,
        BigDecimal subtotal,
        BigDecimal taxableAmount,
        BigDecimal cgst,
        BigDecimal sgst,
        BigDecimal igst,
        BigDecimal totalGst,
        BigDecimal totalAmount,
        List<ItemSnapshot> items,
        int itemCount,
        Instant createdAt
) {
    public record SupplierRef(String id, String name, String phone, String gstin) {
    }

    public record ItemSnapshot(String inventoryId, String medicineId, String medicineName, String batchNumber,
                               String expiryDate, int quantity, BigDecimal purchaseRate, BigDecimal taxableAmount,
                               BigDecimal gstRate, BigDecimal cgst, BigDecimal sgst, BigDecimal igst,
                               BigDecimal amount, String reason) {
    }
}
