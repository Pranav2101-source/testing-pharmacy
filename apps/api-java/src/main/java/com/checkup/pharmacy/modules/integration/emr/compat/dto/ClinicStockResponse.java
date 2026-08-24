package com.checkup.pharmacy.modules.integration.emr.compat.dto;

import java.math.BigDecimal;
import java.time.Instant;
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
 * <h2>Why a quantity alone was not enough</h2>
 * This record originally stopped at {@code availableQuantity}, and the clinic's badge — which
 * switches on {@code stockStatus} — therefore received null for every line and fell through to
 * its "in stock" wording. A medicine the pharmacy had run out of was displayed to the
 * prescriber as <i>"In stock — 0 left"</i>. The distinction the paragraph above describes was
 * being made here and then discarded on the wire, which is worse than never making it: both
 * sides documented a contract that only one of them implemented.
 *
 * <p>So the classification is computed HERE rather than left to the reader. A caller deriving
 * status from a quantity would have to guess this pharmacy's low-stock threshold, and a guess
 * that disagrees with the pharmacy's own screens is a second source of truth about the same
 * shelf.
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
     * @param schedule          drug schedule (H, H1, X). Changes what the counter must legally
     *                          do, and is worth a prescriber seeing before they write it.
     * @param stockStatus       {@code in_stock} | {@code low_stock} | {@code out_of_stock} |
     *                          {@code unknown}. <b>{@code unknown} means the catalogue does not
     *                          list the name</b> — it is the {@code matched: false} case, never
     *                          a stand-in for "we have none". The two must not be merged.
     * @param earliestExpiry    soonest expiry among the batches that can actually be sold, so a
     *                          long course is not started against stock that will not last it.
     *                          Null when nothing sellable is in stock.
     * @param substitutes       same-generic, same-strength, same-form alternatives this pharmacy
     *                          actually holds. Populated only when the requested drug is itself
     *                          short — an alternative to a medicine that is in stock is noise on
     *                          a screen someone is typing into.
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
            String manufacturer,
            String schedule,
            int availableQuantity,
            BigDecimal mrp,
            String stockStatus,
            Instant earliestExpiry,
            List<Substitute> substitutes
    ) {
    }

    /**
     * An alternative the pharmacy can dispense today.
     *
     * <p>Every one of these is confirmed to have sellable stock before it is offered. A
     * substitute list that includes things the pharmacy is also out of would send a doctor
     * round the same loop twice.
     */
    public record Substitute(
            String medicineId,
            String medicineName,
            String manufacturer,
            String strength,
            String form,
            String schedule,
            int availableQuantity,
            BigDecimal mrp
    ) {
    }
}
