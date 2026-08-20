package com.checkup.pharmacy.modules.integration.emr.compat.dto;

/**
 * What the clinic learns from handing over a prescription.
 *
 * <p>Field names are a wire contract — see {@link ClinicIngestRequest}.
 *
 * <p>The two counts are the useful part. A clinic that knows three of five lines could not
 * be matched to the pharmacy's catalogue can say so at the point of prescribing, rather
 * than the patient discovering it at the counter. They are reported rather than treated as
 * errors on purpose: an unmatched line is a prescription a pharmacist completes by hand,
 * not a failed delivery, and refusing the whole document over one unrecognised brand name
 * would make the integration less useful than a phone call.
 *
 * @param prescriptionId    the pharmacy's own id, for later status lookups.
 * @param prescriptionNumber the human-facing number a patient can quote at the counter.
 * @param status            the pharmacy's view of the prescription right now.
 * @param alreadyExisted    true when this prescription had already been received. Best
 *                          effort, and deliberately not authoritative: two simultaneous
 *                          pushes of the same prescription may both report false. Ingestion
 *                          itself is idempotent, so this only ever affects what the clinic
 *                          displays, never what the pharmacy stores.
 * @param unmatchedItemCount lines with no medicine in the pharmacy's catalogue.
 * @param unconfirmedQuantityCount lines that arrived without a usable quantity.
 */
public record ClinicIngestResponse(
        String prescriptionId,
        String prescriptionNumber,
        String status,
        boolean alreadyExisted,
        int unmatchedItemCount,
        int unconfirmedQuantityCount
) {
}
