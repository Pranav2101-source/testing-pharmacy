package com.checkup.pharmacy.modules.integration.emr.dto;

import java.time.Instant;

/**
 * What the pharmacy's own Integrations screen shows about its clinic connection.
 *
 * <p>Deliberately contains no secret material. The key is returned exactly once, by
 * the rotate call, and never again — so this record has to be safe to poll.
 *
 * @param pharmacyId     the id the clinic types into its pharmacy-connection form
 * @param pharmacyName   this pharmacy's display name, for the same form
 * @param pharmacyUrl    the base URL the clinic sends prescriptions to
 * @param clinicName     what the pharmacy called the clinic it connected to
 * @param callbackUrl    where dispensing updates are sent back
 * @param keyIssued      whether a connection key exists (never the key itself)
 * @param connectedAt    when the clinic details were first saved
 * @param keyUpdatedAt   when the pharmacy row last changed — the best available
 *                       proxy for "when the key was last generated"
 * @param prescriptionsReceived   how many prescriptions arrived from a clinic
 * @param lastPrescriptionAt      when the most recent one arrived
 * @param failedDispenseUpdates   dispensing updates the clinic has not accepted
 * @param paired    whether the clinic redeemed a pairing code rather than being connected by
 *                  hand. Drives the frontend: a screen that just generated a code polls this
 *                  endpoint and flips to "Connected" the instant this turns true — the point
 *                  of pairing is that nobody has to click anything to notice the clinic
 *                  finished its half.
 * @param pairedAt  when that pairing completed
 */
public record EmrConnectionStatus(
        String pharmacyId,
        String pharmacyName,
        String pharmacyUrl,
        String clinicName,
        String callbackUrl,
        boolean keyIssued,
        Instant connectedAt,
        Instant keyUpdatedAt,
        long prescriptionsReceived,
        Instant lastPrescriptionAt,
        long pendingDispenseUpdates,
        long failedDispenseUpdates,
        boolean paired,
        Instant pairedAt) {

    /** Connected means both halves exist: somewhere to send, and a credential to sign with. */
    public boolean connected() {
        return (keyIssued || paired) && callbackUrl != null && !callbackUrl.isBlank();
    }
}
