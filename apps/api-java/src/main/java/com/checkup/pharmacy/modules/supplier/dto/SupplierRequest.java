package com.checkup.pharmacy.modules.supplier.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

import java.math.BigDecimal;

/** Shared shape for POST and PATCH /suppliers — the frontend submits the full form on both. */
public record SupplierRequest(
        @NotBlank(message = "Supplier name is required") String name,
        String gstin,
        String dlNumber,
        String phone,
        String email,
        String address,
        String city,
        String state,
        @DecimalMin(value = "0", message = "Credit limit cannot be negative") BigDecimal creditLimit,
        @Min(value = 0, message = "Credit days cannot be negative") Integer creditDays,
        String paymentTerms
) {
}
