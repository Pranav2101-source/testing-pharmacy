package com.checkup.pharmacy.modules.pharmacy.dto;

import com.checkup.pharmacy.common.validation.IndianMobile;
import com.checkup.pharmacy.common.validation.ValidEmail;
import jakarta.validation.constraints.NotBlank;

/**
 * PUT /pharmacy body. Only `name` is required; the rest are optional profile
 * fields the settings form submits (a null field clears that column).
 *
 * <p>No name rule: a pharmacy is a business, and "24x7 Medicos" is a real shop name.
 *
 * <p>The phone and email ARE constrained, and were not before: both print on every
 * invoice, so "98765abc" here is a customer who cannot call the shop back. The
 * registration form has always sent this phone through @IndianMobile — the edit path
 * simply never re-checked it.
 */
public record UpdatePharmacyRequest(
        @NotBlank(message = "Pharmacy name is required") String name,
        @IndianMobile String phone,
        @ValidEmail String email,
        String gstin,
        String drugLicense,
        String address,
        String city,
        String state,
        String pincode,
        String logoUrl
) {
}
