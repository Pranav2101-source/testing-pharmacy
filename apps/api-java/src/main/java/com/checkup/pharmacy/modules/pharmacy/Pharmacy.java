package com.checkup.pharmacy.modules.pharmacy;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.TenantStatus;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * The tenant. Maps the Prisma `Pharmacy` model (table "pharmacies"). Only the
 * columns needed by the current modules are mapped; the rest (invoiceSettings,
 * relations) are added as their owning modules are built.
 *
 * `tenantStatus` is a Postgres enum type — {@code @JdbcTypeCode(NAMED_ENUM)} casts
 * to it. `documents` is a jsonb column stored as raw JSON text
 * ({@code @JdbcTypeCode(JSON)}); the service parses it to/from a JSON tree.
 */
@Entity
@Table(name = "pharmacies")
public class Pharmacy extends BaseEntity {

    @Column(name = "tenantCode")
    private String tenantCode;

    @Column(name = "name")
    private String name;

    @Column(name = "slug")
    private String slug;

    @Column(name = "gstin")
    private String gstin;

    @Column(name = "drugLicense")
    private String drugLicense;

    @Column(name = "phone")
    private String phone;

    @Column(name = "email")
    private String email;

    @Column(name = "address")
    private String address;

    @Column(name = "city")
    private String city;

    @Column(name = "state")
    private String state;

    @Column(name = "pincode")
    private String pincode;

    @Column(name = "logoUrl")
    private String logoUrl;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "documents")
    private String documents;

    // Per-pharmacy invoice/GST/numbering config — a single JSON blob (was the InvoiceSettings
    // 1:1 table, inlined into this column). Stored as raw JSON text, same pattern as `documents`.
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "invoiceSettings")
    private String invoiceSettings;

    // Billing-screen action config (which save actions exist, pinned state, order).
    // Pharmacy-level: it is shop policy, not a per-cashier preference, and must look
    // the same on every till. Same raw-JSON-text pattern as the two columns above.
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "billingPreferences")
    private String billingPreferences;

    // Per-pharmacy secret for the EMR machine-to-machine HMAC surface (see
    // EmrHmacAuthenticationFilter / EmrSecretCipher). AES-256-GCM ciphertext +
    // nonce + auth tag, base64 text columns — same at-rest shape as the EMR
    // side's own PharmacyConnection secret. Null until a platform admin rotates
    // one; the EMR filter fails closed when any of the three is absent.
    @Column(name = "emrSecretCiphertext")
    private String emrSecretCiphertext;

    @Column(name = "emrSecretIv")
    private String emrSecretIv;

    @Column(name = "emrSecretTag")
    private String emrSecretTag;

    @Column(name = "isActive")
    private boolean isActive = true;

    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "tenantStatus")
    private TenantStatus tenantStatus = TenantStatus.ACTIVE;

    protected Pharmacy() {
        // Required by JPA.
    }

    /** Creates an active pharmacy with the required fields; set optionals via setters. */
    public static Pharmacy create(String name, String slug) {
        Pharmacy p = new Pharmacy();
        p.assignId(Cuid.generate());
        p.name = name;
        p.slug = slug;
        p.isActive = true;
        p.tenantStatus = TenantStatus.ACTIVE;
        return p;
    }

    // ── Accessors ─────────────────────────────────────────────────────────────

    public String getTenantCode() { return tenantCode; }

    public String getName() { return name; }

    public String getSlug() { return slug; }

    public String getGstin() { return gstin; }

    public String getDrugLicense() { return drugLicense; }

    public String getPhone() { return phone; }

    public String getEmail() { return email; }

    public String getAddress() { return address; }

    public String getCity() { return city; }

    public String getState() { return state; }

    public String getPincode() { return pincode; }

    public String getLogoUrl() { return logoUrl; }

    public String getDocuments() { return documents; }

    public String getInvoiceSettings() { return invoiceSettings; }

    public void setInvoiceSettings(String invoiceSettings) { this.invoiceSettings = invoiceSettings; }

    public String getBillingPreferences() { return billingPreferences; }

    public void setBillingPreferences(String billingPreferences) { this.billingPreferences = billingPreferences; }

    public void setName(String name) { this.name = name; }

    public void setPhone(String phone) { this.phone = phone; }

    public void setEmail(String email) { this.email = email; }

    public void setAddress(String address) { this.address = address; }

    public void setCity(String city) { this.city = city; }

    public void setState(String state) { this.state = state; }

    public void setPincode(String pincode) { this.pincode = pincode; }

    public void setGstin(String gstin) { this.gstin = gstin; }

    public void setDrugLicense(String drugLicense) { this.drugLicense = drugLicense; }

    public void setLogoUrl(String logoUrl) { this.logoUrl = logoUrl; }

    public void setDocuments(String documents) { this.documents = documents; }

    public void setTenantCode(String tenantCode) { this.tenantCode = tenantCode; }

    public String getEmrSecretCiphertext() { return emrSecretCiphertext; }

    public String getEmrSecretIv() { return emrSecretIv; }

    public String getEmrSecretTag() { return emrSecretTag; }

    /** Stores a freshly-generated, already-encrypted EMR secret (or clears it if any part is null). */
    public void setEmrSecret(String ciphertext, String iv, String tag) {
        this.emrSecretCiphertext = ciphertext;
        this.emrSecretIv = iv;
        this.emrSecretTag = tag;
    }

    public boolean isActive() { return isActive; }

    public TenantStatus getTenantStatus() { return tenantStatus; }

    /** Platform-admin status change: sets the tenant status and active flag together. */
    public void applyStatus(TenantStatus status, boolean active) {
        this.tenantStatus = status;
        this.isActive = active;
    }
}
