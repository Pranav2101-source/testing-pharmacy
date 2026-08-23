package com.checkup.pharmacy.modules.prescription;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@code isFullyDispensed()} decides when a prescription closes as DISPENSED
 * ({@code BillingService.recordDispensing}) and when a retry reports "everything collected"
 * ({@code EmrDispenseCallbackRetryService.buildEvent}). A line the clinic sent with no usable
 * quantity is ingested as {@code quantity == 0} rather than rejected (see
 * {@code ClinicIngestService}) — this covers the regression where that placeholder read as
 * "already fully dispensed" from the moment the line was created, closing a prescription with
 * an unconfirmed line the instant every OTHER line was sold.
 */
class PrescriptionItemTest {

    @Test
    @DisplayName("a line with an unconfirmed (zero) quantity is never fully dispensed, even with dispensedQty at zero too")
    void unconfirmedQuantityLineIsNeverFullyDispensed() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Paracetamol",
                "med_1", null, 0, null, null, null);

        assertThat(item.needsQuantityConfirmation()).isTrue();
        assertThat(item.isFullyDispensed())
                .as("0 >= 0 must not read as 'fully dispensed' — that is a placeholder, not a real amount")
                .isFalse();
    }

    @Test
    @DisplayName("recording units against an unconfirmed line still does not mark it fully dispensed")
    void recordingDispenseAgainstAnUnconfirmedLineDoesNotCloseIt() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Paracetamol",
                "med_1", null, 0, null, null, null);

        item.recordDispensed(5);

        assertThat(item.isFullyDispensed()).isFalse();
    }

    @Test
    @DisplayName("a normal positive-quantity line behaves exactly as before")
    void normalQuantityLineIsUnaffected() {
        PrescriptionItem item = PrescriptionItem.create("ph_1", "rx_1", "Paracetamol", "med_1",
                null, 10, null, null, null);

        assertThat(item.needsQuantityConfirmation()).isFalse();
        assertThat(item.isFullyDispensed()).isFalse();

        item.recordDispensed(10);

        assertThat(item.isFullyDispensed()).isTrue();
    }

    @Test
    @DisplayName("confirming a quantity turns the placeholder into a real, dispensable amount")
    void confirmingQuantityMakesTheLineDispensable() {
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", "rx_1", "item-1", "Paracetamol",
                "med_1", null, 0, null, null, null);

        item.confirmQuantity(6);

        assertThat(item.needsQuantityConfirmation()).isFalse();
        assertThat(item.getQuantity()).isEqualTo(6);
        assertThat(item.isFullyDispensed()).isFalse();

        item.recordDispensed(6);
        assertThat(item.isFullyDispensed()).isTrue();
    }
}
