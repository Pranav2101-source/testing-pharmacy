package com.checkup.pharmacy.modules.prescription.dto;

import jakarta.validation.constraints.Positive;

/**
 * Settles the real quantity for a line the clinic sent without one — see
 * {@code PrescriptionItem#needsQuantityConfirmation}. Chosen by a pharmacist, from the paper
 * prescription or the patient at the counter, the same way an unmatched medicine is resolved
 * by a human rather than guessed.
 */
public record ConfirmPrescriptionItemQuantityRequest(@Positive int quantity) {
}
