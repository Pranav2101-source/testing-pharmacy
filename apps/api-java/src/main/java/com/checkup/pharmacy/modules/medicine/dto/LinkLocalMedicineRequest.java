package com.checkup.pharmacy.modules.medicine.dto;

import jakarta.validation.constraints.NotBlank;

/** A pharmacist confirming (or manually picking) the global catalogue medicine a local one really is. */
public record LinkLocalMedicineRequest(@NotBlank String medicineId) {
}
