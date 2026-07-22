package com.checkup.pharmacy.modules.suppliercreditnote.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateCreditNoteStatusRequest(
        @NotBlank String status,
        @Size(max = 500) String notes
) {
}
