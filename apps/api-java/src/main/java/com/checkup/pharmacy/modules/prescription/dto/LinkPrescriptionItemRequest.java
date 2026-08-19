package com.checkup.pharmacy.modules.prescription.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * Links a prescription line the EMR sent to a product in this pharmacy's catalogue.
 *
 * <p>The medicine is chosen by a pharmacist, never guessed. The ingest matcher deliberately
 * refuses to fuzzy-match: the catalogue is shared platform-wide, and booking a sale against
 * a plausible-but-wrong product is a dispensing error, not a data-quality one.
 */
public record LinkPrescriptionItemRequest(@NotBlank String medicineId) {
}
