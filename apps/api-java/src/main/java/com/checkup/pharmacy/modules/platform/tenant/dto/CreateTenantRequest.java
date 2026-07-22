package com.checkup.pharmacy.modules.platform.tenant.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Platform-admin request to provision a new tenant (pharmacy + owner +
 * subscription + settings). Mirrors the Node {@code createTenantSchema}. Optional
 * numeric/boolean fields are boxed so an omitted value falls through to the
 * service default rather than a primitive 0/false.
 */
public record CreateTenantRequest(
        @NotBlank(message = "Pharmacy name is required") @Size(min = 2, message = "Pharmacy name is required") String name,
        String gstin,
        String drugLicense,
        String address,
        String city,
        String state,
        String pincode,
        String phone,
        @Email(message = "Invalid pharmacy email") String email,

        @NotBlank(message = "Owner name is required") @Size(min = 2, message = "Owner name is required") String ownerName,
        @NotBlank(message = "Owner email is required") @Email(message = "Invalid owner email") String ownerEmail,
        String ownerPhone,

        String planName,

        Integer doctorLimit,
        Integer staffLimit,
        Integer patientLimit,
        Integer storageLimit,
        Boolean enableBilling,
        Boolean enableInventory,
        Boolean enableEmr,
        Boolean enableCrm,
        Boolean enableWhatsapp,
        Boolean enableSms,
        Boolean enableApiAccess,
        Boolean enableOnlineBooking) {
}
