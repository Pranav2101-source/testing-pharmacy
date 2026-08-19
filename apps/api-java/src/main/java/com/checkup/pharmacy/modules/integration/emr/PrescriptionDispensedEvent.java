package com.checkup.pharmacy.modules.integration.emr;

import java.time.Instant;
import java.util.List;

/**
 * Raised after a sale against a clinic-sent prescription has committed.
 *
 * <p>Internal, and deliberately not the wire format — see {@link
 * com.checkup.pharmacy.modules.integration.emr.dto.EmrDispensePayload}. This carries
 * everything the delivery needs so the background thread never has to go back to the
 * database for it, which matters because that thread has no tenant and a hard timeout.
 *
 * <p>Quantities are CUMULATIVE totals per line, not this sale's increment. That is what
 * makes redelivery safe: sending the same payload twice sets the same numbers again
 * rather than doubling them, so every recovery path can simply try again.
 */
public record PrescriptionDispensedEvent(
        String pharmacyId,
        String prescriptionId,
        String prescriptionNumber,
        String externalTenantId,
        String externalPrescriptionId,
        String invoiceNumber,
        Instant dispensedAt,
        boolean fullyDispensed,
        List<DispensedItem> items) {

    public record DispensedItem(
            String externalItemId,
            String prescribedName,
            String dispensedName,
            int dispensedQty,
            int prescribedQty,
            boolean substituted) {
    }
}
