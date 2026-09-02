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
            /**
             * Unreserved SEALED packs on the batch — always a pack count, for both a
             * PACK and a LOOSE line (the client multiplies by {@code unitsPerPack} and
             * adds {@code looseUnits} to get the piece ceiling for a loose line). Only
             * {@code quantity} is in pieces on a LOOSE line.
             */
            int availableStock,
            int requestedQuantity,
            boolean capped,
            // Carried so a customer's regular loose order comes back as loose, not a
            // full pack — and so a PACK line for a loose-capable medicine still offers
            // the Strip / piece toggle. PACK for every ordinary line.
            String saleUnit,
            Integer unitsPerPack,
            String baseUnit,
            /** This pharmacy currently sells the medicine loose — shows the toggle even on a PACK repeat line. */
            boolean allowLooseSale,
            /** Loose pieces already open on the batch — part of what a LOOSE line can draw on. */
            int looseUnits
    ) {
    }

    public record Unavailable(String medicineName, String reason) {
    }
}
