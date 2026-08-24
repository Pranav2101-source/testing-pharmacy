package com.checkup.pharmacy.modules.prescription.dto;

import java.util.List;

/**
 * Live stock, per prescribed line, for the triage screen's stock-check step.
 *
 * <p>Deliberately its own endpoint rather than folded into {@link PrescriptionResponse}: a
 * prescription is read far more often than its stock changes (every list-page render, every
 * poll), and a batch getting sold or received should not require a fresh {@code /prescriptions}
 * round trip to be reflected. Computed in one batched query per {@link
 * com.checkup.pharmacy.modules.prescription.PrescriptionService#stockCheck}, not one FEFO
 * lookup per line — this is a preview for a human to scan, not a reservation, so it does not
 * need FEFO's batch-picking order.
 */
public record PrescriptionStockResponse(List<Item> items) {

    /**
     * @param itemId       the prescription line this describes.
     * @param medicineId   the catalogue product being checked.
     * @param availableQty total non-expired, active stock across all this pharmacy's batches.
     * @param stockStatus  {@code "out_of_stock"}, {@code "low_stock"}, or {@code "in_stock"} —
     *                     same three-way classification and threshold as the billing
     *                     alternatives drawer, so a pharmacist reads the same colour for the
     *                     same stock level everywhere in the app.
     */
    public record Item(String itemId, String medicineId, int availableQty, String stockStatus) {
    }
}
