package com.checkup.pharmacy.modules.customer.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;

import java.math.BigDecimal;

/**
 * Shared shape for POST and PATCH /customers — the frontend always submits the
 * full form on both create and edit, so there is no separate partial-update DTO.
 */
public record CustomerRequest(
        @NotBlank(message = "Name is required") String name,
        String phone,
        String email,
        String gender,
        String dateOfBirth, // "YYYY-MM-DD" from an <input type=date>
        String abhaNumber,
        String cardNumber,
        String customerType,
        @DecimalMin(value = "0", message = "Discount must be between 0 and 100")
        @DecimalMax(value = "100", message = "Discount must be between 0 and 100")
        BigDecimal defaultDiscount,
        @DecimalMin(value = "0", message = "Credit limit cannot be negative")
        BigDecimal creditLimit,
        String address,
        String state,
        String notes
) {
}
