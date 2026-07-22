package com.checkup.pharmacy.modules.platform.domain;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * Per-tenant plan limits + feature flags (table "tenant_settings"), 1:1 with a
 * {@link com.checkup.pharmacy.modules.pharmacy.Pharmacy}. Written when the
 * platform admin provisions or edits a tenant; the flags gate optional product
 * surfaces (EMR, CRM, WhatsApp, …). Defaults mirror the Prisma model.
 */
@Entity
@Table(name = "tenant_settings")
public class TenantSettings extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "doctorLimit")
    private int doctorLimit = 5;

    @Column(name = "staffLimit")
    private int staffLimit = 5;

    @Column(name = "patientLimit")
    private int patientLimit = 500;

    @Column(name = "storageLimit")
    private int storageLimit = 1024;

    @Column(name = "enableBilling")
    private boolean enableBilling = true;

    @Column(name = "enableInventory")
    private boolean enableInventory = true;

    @Column(name = "enableEmr")
    private boolean enableEmr = false;

    @Column(name = "enableCrm")
    private boolean enableCrm = false;

    @Column(name = "enableWhatsapp")
    private boolean enableWhatsapp = false;

    @Column(name = "enableSms")
    private boolean enableSms = false;

    @Column(name = "enableApiAccess")
    private boolean enableApiAccess = false;

    @Column(name = "enableOnlineBooking")
    private boolean enableOnlineBooking = false;

    protected TenantSettings() {
        // Required by JPA.
    }

    public static TenantSettings create(String pharmacyId, int doctorLimit, int staffLimit, int patientLimit,
                                        int storageLimit, boolean enableBilling, boolean enableInventory,
                                        boolean enableEmr, boolean enableCrm, boolean enableWhatsapp,
                                        boolean enableSms, boolean enableApiAccess, boolean enableOnlineBooking) {
        TenantSettings t = new TenantSettings();
        t.assignId(Cuid.generate());
        t.pharmacyId = pharmacyId;
        t.doctorLimit = doctorLimit;
        t.staffLimit = staffLimit;
        t.patientLimit = patientLimit;
        t.storageLimit = storageLimit;
        t.enableBilling = enableBilling;
        t.enableInventory = enableInventory;
        t.enableEmr = enableEmr;
        t.enableCrm = enableCrm;
        t.enableWhatsapp = enableWhatsapp;
        t.enableSms = enableSms;
        t.enableApiAccess = enableApiAccess;
        t.enableOnlineBooking = enableOnlineBooking;
        return t;
    }

    // ── Accessors ─────────────────────────────────────────────────────────────

    public String getPharmacyId() { return pharmacyId; }

    public int getDoctorLimit() { return doctorLimit; }

    public int getStaffLimit() { return staffLimit; }

    public int getPatientLimit() { return patientLimit; }

    public int getStorageLimit() { return storageLimit; }

    public boolean isEnableBilling() { return enableBilling; }

    public boolean isEnableInventory() { return enableInventory; }

    public boolean isEnableEmr() { return enableEmr; }

    public boolean isEnableCrm() { return enableCrm; }

    public boolean isEnableWhatsapp() { return enableWhatsapp; }

    public boolean isEnableSms() { return enableSms; }

    public boolean isEnableApiAccess() { return enableApiAccess; }

    public boolean isEnableOnlineBooking() { return enableOnlineBooking; }
}
