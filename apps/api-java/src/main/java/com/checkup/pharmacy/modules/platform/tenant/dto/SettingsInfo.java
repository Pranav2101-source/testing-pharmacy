package com.checkup.pharmacy.modules.platform.tenant.dto;

import com.checkup.pharmacy.modules.platform.domain.TenantSettings;

/** Tenant plan limits + feature flags, embedded in tenant detail/create responses. */
public record SettingsInfo(
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

    public static SettingsInfo from(TenantSettings t) {
        if (t == null) {
            return null;
        }
        return new SettingsInfo(t.getDoctorLimit(), t.getStaffLimit(), t.getPatientLimit(), t.getStorageLimit(),
                t.isEnableBilling(), t.isEnableInventory(), t.isEnableEmr(), t.isEnableCrm(), t.isEnableWhatsapp(),
                t.isEnableSms(), t.isEnableApiAccess(), t.isEnableOnlineBooking());
    }
}
