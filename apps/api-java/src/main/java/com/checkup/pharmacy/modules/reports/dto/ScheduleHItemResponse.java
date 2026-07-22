package com.checkup.pharmacy.modules.reports.dto;

import java.time.Instant;

public record ScheduleHItemResponse(String id, int quantity, InvoiceRef invoice, InventoryRef inventory) {

    public record InvoiceRef(String invoiceNumber, Instant createdAt, String prescriptionId, String doctorName,
                             CustomerRef customer, UserRef user) {
    }

    public record CustomerRef(String name, String phone) {
    }

    public record UserRef(String name) {
    }

    public record InventoryRef(MedicineRef medicine) {
    }

    public record MedicineRef(String name, String genericName, String schedule, String strength, String form) {
    }
}
