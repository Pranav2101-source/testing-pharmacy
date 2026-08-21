package com.checkup.pharmacy.modules.integration.emr.compat.dto;

import java.math.BigDecimal;
import java.util.List;

/**
 * What the pharmacy holds, answered at prescribing time.
 *
 * <p>Field names are a wire contract — see {@link ClinicIngestRequest}.
 *
 * <h2>Why "unknown" and "none" must stay distinguishable</h2>
 * {@code matched} is separate from {@code availableQuantity} on purpose. A medicine the
 * pharmacy has never heard of and a medicine it has run out of look identical if both
 * collapse to a zero — and they mean opposite things to a prescriber. "We do not stock this"
 * invites a substitution; "we are out of this" invites waiting until tomorrow. Reporting an
 * unmatched line as zero stock would quietly turn the first into the second.
 *
 * @param namesOmitted names the caller sent that were dropped before lookup — blank, or past
 *                     the per-request cap. Reported so a truncated answer is never mistaken
 *                     for a complete one.
 */
public record ClinicStockResponse(
        String pharmacyName,
        List<Item> items,
        int namesOmitted
) {

    /**
     * @param requestedName     echoed back exactly as sent, so the caller can line answers up
     *                          with its own request without depending on ordering.
     * @param matched           whether this name resolved to a medicine in the catalogue.
     * @param availableQuantity sellable units — stock on hand minus what is already reserved.
     *                          Meaningful only when {@code matched} is true.
     * @param mrp               the lowest MRP across the batches that can actually be sold,
     *                          which is the price a patient would be quoted. Null when
     *                          nothing sellable is in stock.
     */
    public record Item(
            String requestedName,
            boolean matched,
            String medicineId,
            String medicineName,
            String genericName,
            String strength,
            String form,
            String unit,
            int availableQuantity,
            BigDecimal mrp
    ) {
    }
}
