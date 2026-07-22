package com.checkup.pharmacy.modules.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Registration payload — creates a pharmacy (tenant) and its owner user.
 * Mirrors the fields the registration form sends; the optional block
 * (city…pincode) may be absent.
 */
public record RegisterRequest(
        @NotBlank @Size(min = 2) String pharmacyName,
        @NotBlank @Size(min = 2) String ownerName,
        @NotBlank @Pattern(regexp = "^[6-9]\\d{9}$", message = "Enter a valid 10-digit mobile number") String phone,
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
