package com.checkup.pharmacy.modules.billing.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * "Repeat last bill" — the customer's most recent invoice, re-resolved against
 * *current* stock (the original batch may since be sold out, expired, or
 * quarantined). Each line either carries forward at the original quantity, is
 * capped to whatever is currently available, or is dropped into
 * {@code unavailable} if nothing sellable remains for that medicine.
 */
public record RepeatCartResponse(
        String invoiceNumber,
        Instant invoiceDate,
        List<Item> items,
        List<Unavailable> unavailable
) {
    public record Item(
            String inventoryId,
            String medicineName,
            String hsnCode,
            String schedule,
            String packSize,
            String location,
            String batchNumber,
            Instant expiryDate,
            BigDecimal mrp,
            BigDecimal gstRate,
            BigDecimal discount,
            int quantity,
            int availableStock,
            int requestedQuantity,
            boolean capped
    ) {
    }

    public record Unavailable(String medicineName, String reason) {
    }
}
