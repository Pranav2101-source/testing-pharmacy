package com.checkup.pharmacy.modules.integration.emr.dto;

import com.checkup.pharmacy.modules.integration.emr.PrescriptionDispensedEvent;

import java.time.Instant;
import java.util.List;

/**
 * The body of the dispense callback — the pharmacy's half of the wire contract with
 * checkup.care.
 *
 * <p>Separate from {@code PrescriptionDispensedEvent} rather than serialising that
 * directly. The event is an internal signal and will change shape as billing changes;
 * this is a published contract another team deserialises in another repository, and it
 * should only change when we mean to change it. Keeping them apart means an internal
 * refactor cannot silently alter what a clinic receives.
 *
 * <p>Note what is <b>not</b> here: no diagnosis, no notes, no consultation content, no
 * pricing. The clinic is being told what its patient collected, which is the minimum that
 * makes a chart correct.
 *
 * @param externalTenantId       which clinic this concerns. Present because one endpoint
 *                               serves every tenant — the receiver routes on it.
 * @param externalPrescriptionId the clinic's own id, the key it matches on.
 * @param status                 {@code DISPENSED} when everything has been collected,
 *                               otherwise {@code PARTIALLY_DISPENSED}. A word rather than
 *                               a boolean because it is rendered directly in a chart.
 * @param items                  cumulative totals per line, so redelivery is idempotent.
 */
public record EmrDispensePayload(
        String externalTenantId,
        String externalPrescriptionId,
        String pharmacyPrescriptionNumber,
        String invoiceNumber,
        Instant dispensedAt,
        String status,
        List<Item> items) {

    public static final String STATUS_DISPENSED = "DISPENSED";
    public static final String STATUS_PARTIAL = "PARTIALLY_DISPENSED";

    /**
     * @param externalItemId the clinic's id for the prescribed line. Null means the clinic
     *                       must fall back to matching on name.
     * @param dispensedQty   cumulative units handed over against this line, all sales
     *                       included — not this sale's increment.
     * @param substituted    true when a different product was dispensed from the one
     *                       prescribed; {@code dispensedName} then says what.
     */
    public record Item(
            String externalItemId,
            String prescribedName,
            String dispensedName,
            int dispensedQty,
            int prescribedQty,
            boolean substituted) {
    }

    public static EmrDispensePayload from(PrescriptionDispensedEvent event) {
        return new EmrDispensePayload(
                event.externalTenantId(),
                event.externalPrescriptionId(),
                event.prescriptionNumber(),
                event.invoiceNumber(),
                event.dispensedAt(),
                event.fullyDispensed() ? STATUS_DISPENSED : STATUS_PARTIAL,
                event.items().stream()
                        .map(i -> new Item(i.externalItemId(), i.prescribedName(), i.dispensedName(),
                                i.dispensedQty(), i.prescribedQty(), i.substituted()))
                        .toList());
    }
}
