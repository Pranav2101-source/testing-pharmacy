package com.checkup.pharmacy.modules.integration.emr.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/** Complete reconciliation shape returned by GET and embedded in every callback event. */
public record EmrPrescriptionSnapshot(
        String pharmacyId,
        String pharmacyPrescriptionId,
        String pharmacyPrescriptionNumber,
        String externalTenantId,
        String externalPrescriptionId,
        String externalPrescriptionNumber,
        String status,
        Instant receivedAt,
        List<Item> items,
        List<Invoice> invoices
) {
    public record Item(String externalItemId, String medicineId, String medicineName,
                       int prescribedQuantity, int dispensedQuantity) {
    }

    public record Invoice(String invoiceId, String invoiceNumber, String status, String paymentStatus,
                          BigDecimal totalAmount, BigDecimal returnedAmount, Instant createdAt) {
    }
}
