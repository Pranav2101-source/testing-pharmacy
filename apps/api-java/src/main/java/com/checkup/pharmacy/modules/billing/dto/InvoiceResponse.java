package com.checkup.pharmacy.modules.billing.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record InvoiceResponse(
        String id,
        String invoiceNumber,
        CustomerRef customer,
        String customerName,
        String customerPhone,
        UserRef user,
        String doctorId,
        String doctorName,
        String doctorRegNo,
        String prescriptionId,
        PrescriptionRef prescription,
        String paymentMode,
        String paymentStatus,
        String status,
        BigDecimal subtotal,
        BigDecimal discountAmount,
        BigDecimal taxableAmount,
        BigDecimal cgst,
        BigDecimal sgst,
        BigDecimal igst,
        BigDecimal totalGst,
        BigDecimal totalAmount,
        // Stored so a bill can be reconciled from what it reports:
        // taxable + totalGst + extraCharges + adjustmentAmount + roundOff == totalAmount.
        BigDecimal extraCharges,
        BigDecimal adjustmentAmount,
        BigDecimal roundOff,
        BigDecimal returnedAmount,
        boolean isInterstate,
        String notes,
        boolean isCancelled,
        Instant cancelledAt,
        String cancelReason,
        List<Item> items,
        List<PaymentResponse> payments,
        List<ReturnRef> returns,
        Instant createdAt,
        Instant updatedAt
) {
    public record CustomerRef(String id, String name, String phone, String email) {
    }

    public record UserRef(String id, String name) {
    }

    public record PrescriptionRef(String id, String prescriptionNumber, String doctorName, String patientName, String status) {
    }

    public record ReturnRef(String id, String returnNumber, BigDecimal totalAmount, Instant createdAt) {
    }

    /** {@code freeQty} is scheme quantity given free — not charged, but dispensed. */
    public record Item(String id, String inventoryId, String medicineName, String hsnCode, String batchNumber,
                       Instant expiryDate, int quantity, int freeQty, BigDecimal mrp, BigDecimal rate,
                       BigDecimal purchaseRate,
                       BigDecimal discount, BigDecimal gstRate, BigDecimal cgst, BigDecimal sgst, BigDecimal igst,
                       BigDecimal taxableAmount, BigDecimal amount, String location) {
    }
}
