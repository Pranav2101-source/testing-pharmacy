package com.checkup.pharmacy.modules.inventory.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record BatchRecallRequest(
        @NotBlank @Size(max = 50) String batchNumber,
        String medicineId,
        @NotBlank @Size(max = 500) String reason
) {
}
