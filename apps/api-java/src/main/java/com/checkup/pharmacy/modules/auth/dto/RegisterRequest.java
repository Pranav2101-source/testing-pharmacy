package com.checkup.pharmacy.modules.auth.dto;

import com.checkup.pharmacy.common.validation.IndianMobile;
import com.checkup.pharmacy.common.validation.PersonName;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Registration payload — creates a pharmacy (tenant) and its owner user.
 * Mirrors the fields the registration form sends; the optional block
 * (city…pincode) may be absent.
 */
public record RegisterRequest(
        // No @PersonName here: a pharmacy is a business, and "24x7 Medicos" is a real
        // shop name. Only the owner is a person.
        @NotBlank @Size(min = 2) String pharmacyName,
        @NotBlank @Size(min = 2) @PersonName String ownerName,
        @NotBlank(message = "Mobile number is required") @IndianMobile String phone,
        @NotBlank @Email String email,
        @NotBlank @Size(min = 8, message = "Password must be at least 8 characters") String password,
        String city,
        String gstin,
        String drugLicense,
        String address,
        String state,
        String pincode
) {
}
