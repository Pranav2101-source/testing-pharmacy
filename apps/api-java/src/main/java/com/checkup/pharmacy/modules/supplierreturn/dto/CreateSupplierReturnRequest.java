package com.checkup.pharmacy.modules.supplierreturn.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

public record CreateSupplierReturnRequest(
        @NotBlank String supplierId,
        @Size(max = 50) String debitNoteNo,
        @Size(max = 1000) String notes,
        @NotEmpty @Valid List<SupplierReturnItemRequest> items
) {
}
