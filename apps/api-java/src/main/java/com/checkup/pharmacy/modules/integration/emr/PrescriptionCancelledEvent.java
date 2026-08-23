package com.checkup.pharmacy.modules.integration.emr;

import java.time.Instant;

/**
 * Raised after a pharmacist has cancelled a clinic-sourced prescription.
 *
 * <p>The mirror of {@link PrescriptionDispensedEvent}: that one tells a clinic what its
 * patient collected, this one tells a clinic the script it wrote no longer stands. Without
 * it a doctor who withdraws a prescription at the pharmacy end — wrong medicine linked, a
 * duplicate push, a patient who never came to collect it — has no way to know, and may
 * write a repeat that assumes the original is still active.
 *
 * <p>Internal, and deliberately not the wire format — see
 * {@link com.checkup.pharmacy.modules.integration.emr.dto.EmrCancelPayload}.
 */
public record PrescriptionCancelledEvent(
        String pharmacyId,
        String prescriptionId,
        String prescriptionNumber,
        String externalTenantId,
        String externalPrescriptionId,
        Instant cancelledAt) {
}
