package com.checkup.pharmacy.modules.integration.emr.dto;

import com.checkup.pharmacy.modules.integration.emr.PrescriptionCancelledEvent;

import java.time.Instant;

/**
 * The body of the cancellation callback — the mirror of {@link EmrDispensePayload}.
 *
 * <p>Deliberately thin: unlike a dispense, a cancellation carries no item-level detail. The
 * clinic only needs to know that this prescription no longer stands, not what would have
 * been sold against it.
 *
 * @param externalTenantId       which clinic this concerns.
 * @param externalPrescriptionId the clinic's own id, the key it matches on.
 */
public record EmrCancelPayload(
        String externalTenantId,
        String externalPrescriptionId,
        String pharmacyPrescriptionNumber,
        Instant cancelledAt) {

    public static EmrCancelPayload from(PrescriptionCancelledEvent event) {
        return new EmrCancelPayload(
                event.externalTenantId(),
                event.externalPrescriptionId(),
                event.prescriptionNumber(),
                event.cancelledAt());
    }
}
