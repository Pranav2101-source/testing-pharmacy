package com.checkup.pharmacy.modules.prescription.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

public record PrescriptionItemRequest(
        @NotBlank @Size(max = 200) String medicineName,
        String medicineId,
        String schedule,
        @NotNull @Positive Integer quantity,
        @Size(max = 100) String dosage,
        @Size(max = 100) String duration,
        @Size(max = 200) String notes
) {
}
