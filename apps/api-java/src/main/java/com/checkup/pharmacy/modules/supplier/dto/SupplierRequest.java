package com.checkup.pharmacy.modules.supplier.dto;

import com.checkup.pharmacy.common.validation.IndianMobile;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

import java.math.BigDecimal;

/** Shared shape for POST and PATCH /suppliers — the frontend submits the full form on both. */
public record SupplierRequest(
        // No @PersonName: a distributor is a business. "A-1 Pharma 24x7 Pvt Ltd" is a
        // real name and must stay accepted.
        @NotBlank(message = "Supplier name is required") String name,
        String gstin,
        String dlNumber,
        // Optional — some distributors are reached only by email — but checked when
        // present, which is all the email field beside it ever did.
        @IndianMobile String phone,
        @Email(message = "Enter a valid email address") String email,
        String address,
        String city,
        String state,
        @DecimalMin(value = "0", message = "Credit limit cannot be negative") BigDecimal creditLimit,
        @Min(value = 0, message = "Credit days cannot be negative") Integer creditDays,
        String paymentTerms
) {
}
