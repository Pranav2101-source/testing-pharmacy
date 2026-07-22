package com.checkup.pharmacy.modules.platform.tenant;

/**
 * Fully-resolved input to {@link PharmacyOnboardingService#onboard} — every
 * optional/defaulted field has already been settled by the caller, so the
 * onboarding service is pure provisioning with no default logic of its own.
 * {@code ownerPasswordHash} is a bcrypt hash; the plaintext never reaches here.
 */
public record OnboardCommand(
        String name,
        String gstin,
        String drugLicense,
        String phone,
        String email,
        String address,
        String city,
        String state,
        String pincode,

        boolean createOwner,
        String ownerName,
        String ownerEmail,
        String ownerPhone,
        String ownerPasswordHash,

        String planName,
        String billingCycle,

        int doctorLimit,
        int staffLimit,
        int patientLimit,
        int storageLimit,
        boolean enableBilling,
        boolean enableInventory,
        boolean enableEmr,
        boolean enableCrm,
        boolean enableWhatsapp,
        boolean enableSms,
        boolean enableApiAccess,
        boolean enableOnlineBooking) {
}
