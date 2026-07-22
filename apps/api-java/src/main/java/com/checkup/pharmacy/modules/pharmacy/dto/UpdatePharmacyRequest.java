package com.checkup.pharmacy.modules.pharmacy.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * PUT /pharmacy body. Only `name` is required; the rest are optional profile
 * fields the settings form submits (a null field clears that column).
 */
public record UpdatePharmacyRequest(
        @NotBlank(message = "Pharmacy name is required") String name,
        String phone,
        String email,
        String gstin,
        String drugLicense,
        String address,
        String city,
        String state,
        String pincode,
        String logoUrl
) {
}
