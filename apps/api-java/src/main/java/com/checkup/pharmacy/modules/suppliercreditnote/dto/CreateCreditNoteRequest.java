package com.checkup.pharmacy.modules.suppliercreditnote.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;

public record CreateCreditNoteRequest(
        @NotBlank String supplierId,
        String supplierReturnId,
        @NotNull @Positive BigDecimal amount,
        /** The supplier's own credit note number, when this wasn't raised against a return — optional. */
        @Size(max = 100) String reference,
        @Size(max = 500) String notes,
        Instant issuedAt
) {
}
