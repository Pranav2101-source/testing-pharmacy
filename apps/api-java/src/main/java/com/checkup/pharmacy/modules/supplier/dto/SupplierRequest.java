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
        /**
         * Required, and validated against {@link com.checkup.pharmacy.common.tax.IndianState}
         * in the service.
         *
         * <p>This is a tax field, not an address field. Whether a purchase attracts IGST or
         * CGST+SGST is decided by comparing this against the pharmacy's own state, and a
         * supplier with none is silently treated as local — which is how a pharmacy ends up
         * claiming input credit under a head it never paid. 72 of 77 suppliers had it blank
         * when this was made required.
         */
        @NotBlank(message = "Supplier state is required — it decides whether purchases attract IGST or CGST+SGST")
        String state,
        @DecimalMin(value = "0", message = "Credit limit cannot be negative") BigDecimal creditLimit,
        @Min(value = 0, message = "Credit days cannot be negative") Integer creditDays,
        String paymentTerms
) {
}
