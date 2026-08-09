package com.checkup.pharmacy.modules.customer.dto;

import com.checkup.pharmacy.common.validation.IndianMobile;
import com.checkup.pharmacy.common.validation.PersonName;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

import java.math.BigDecimal;

/**
 * Shared shape for POST and PATCH /customers — the frontend always submits the
 * full form on both create and edit, so there is no separate partial-update DTO.
 */
@PhoneRequiredUnlessWalkIn
public record CustomerRequest(
        // The frontend collects first and last name separately and sends them joined,
        // so the cap is the sum of the two 100-character halves plus the space.
        @NotBlank(message = "Name is required") @PersonName(max = 201) String name,
        // Presence is decided by @PhoneRequiredUnlessWalkIn above, because it depends
        // on customerType. @IndianMobile still governs the shape of whatever is sent.
        @IndianMobile String phone,
        @Email(message = "Enter a valid email address") String email,
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
