package com.checkup.pharmacy.modules.pharmacy;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.TenantStatus;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

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

    /**
     * SHA-256 of the plaintext key (ApiSecretHasher), written alongside the ciphertext at
     * the one moment the plaintext exists server-side. Lets a pairing code be found by an
     * indexed equality lookup instead of decrypting every pharmacy's secret to compare
     * plaintexts — see ClinicPairingService#findByPairingCode and migration
     * 20260823000002. Null for a pharmacy whose key predates this column.
     */
    @Column(name = "emrSecretLookupHash")
    private String emrSecretLookupHash;

    // The clinic this pharmacy is connected to, entered by the pharmacy itself on
    // its Integrations screen. The callback URL carries the clinic's own connection
    // id in its path, so it cannot be one process-wide address shared by every
    // tenant — the app-level property is only a fallback for pharmacies onboarded
    // before this screen existed.
    @Column(name = "emrClinicName")
    private String emrClinicName;

    @Column(name = "emrCallbackUrl")
    private String emrCallbackUrl;

    @Column(name = "emrConnectedAt")
    private Instant emrConnectedAt;

    // ─── Automatic pairing (compatibility surface) ───────────────────────────
    // Established in one exchange: the clinic presents the code the pharmacist
    // generated and hands over where to reach it plus the secret to sign
    // callbacks with; we answer with a credential scoped to that clinic.

    @Column(name = "emrClinicExternalId")
    private String emrClinicExternalId;

    @Column(name = "emrClinicLinkId")
    private String emrClinicLinkId;

    @Column(name = "emrPairedAt")
    private Instant emrPairedAt;

    // An identifier, not a secret: it arrives in a header on every request and is
    // what the pharmacy is looked up by, so it is stored in the clear.
    @Column(name = "emrApiKey")
    private String emrApiKey;

    // SHA-256 of the secret half. Shown to the clinic once at pairing and never
    // recoverable — a lost secret is re-paired, not recovered.
    @Column(name = "emrApiSecretHash")
    private String emrApiSecretHash;

    // The CLINIC's webhook secret, encrypted at rest exactly like emrSecret*.
    // Its presence is what marks this link as speaking the clinic's callback
    // dialect — the secret is the thing you sign with, so holding one and using
    // it cannot drift apart the way a separate flag could.
    @Column(name = "emrWebhookSecretCiphertext")
    private String emrWebhookSecretCiphertext;

    @Column(name = "emrWebhookSecretIv")
    private String emrWebhookSecretIv;

    @Column(name = "emrWebhookSecretTag")
    private String emrWebhookSecretTag;

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

    public String getEmrSecretLookupHash() { return emrSecretLookupHash; }

    /**
     * Stores a freshly-generated, already-encrypted EMR secret (or clears it if every part
     * is null). {@code lookupHash} travels with the ciphertext rather than through a
     * separate setter — the two must never be able to drift apart, the same discipline
     * already applied to {@link #usesClinicCallbackDialect()}.
     */
    public void setEmrSecret(String ciphertext, String iv, String tag, String lookupHash) {
        this.emrSecretCiphertext = ciphertext;
        this.emrSecretIv = iv;
        this.emrSecretTag = tag;
        this.emrSecretLookupHash = lookupHash;
    }

    public String getEmrClinicName() { return emrClinicName; }

    public String getEmrCallbackUrl() { return emrCallbackUrl; }

    public Instant getEmrConnectedAt() { return emrConnectedAt; }

    /** Records which clinic this pharmacy sends dispensing updates to. */
    public void connectEmrClinic(String clinicName, String callbackUrl) {
        this.emrClinicName = clinicName;
        this.emrCallbackUrl = callbackUrl;
        if (this.emrConnectedAt == null) {
            this.emrConnectedAt = Instant.now();
        }
    }

    /**
     * Disconnects the clinic: forgets the address AND every credential, so neither
     * direction of the integration keeps working on a connection the pharmacy
     * has said it no longer wants.
     *
     * <p>This must clear the pairing state as well as the HMAC secret. Leaving a
     * live API key behind would mean "disconnected" on the pharmacy's own screen
     * while the clinic could still push prescriptions — a half-revoked link is
     * the state nobody can reason about, and it is exactly the hole an earlier
     * audit found when unlinking revoked a link but not its credential.
     */
    public void disconnectEmrClinic() {
        this.emrClinicName = null;
        this.emrCallbackUrl = null;
        this.emrConnectedAt = null;
        setEmrSecret(null, null, null, null);

        this.emrClinicExternalId = null;
        this.emrClinicLinkId = null;
        this.emrPairedAt = null;
        this.emrApiKey = null;
        this.emrApiSecretHash = null;
        setEmrWebhookSecret(null, null, null);
    }

    public String getEmrClinicExternalId() { return emrClinicExternalId; }

    public String getEmrClinicLinkId() { return emrClinicLinkId; }

    public Instant getEmrPairedAt() { return emrPairedAt; }

    public String getEmrApiKey() { return emrApiKey; }

    public String getEmrApiSecretHash() { return emrApiSecretHash; }

    public String getEmrWebhookSecretCiphertext() { return emrWebhookSecretCiphertext; }

    public String getEmrWebhookSecretIv() { return emrWebhookSecretIv; }

    public String getEmrWebhookSecretTag() { return emrWebhookSecretTag; }

    /** Stores the clinic's already-encrypted webhook secret (or clears it if any part is null). */
    public void setEmrWebhookSecret(String ciphertext, String iv, String tag) {
        this.emrWebhookSecretCiphertext = ciphertext;
        this.emrWebhookSecretIv = iv;
        this.emrWebhookSecretTag = tag;
    }

    /**
     * Records a completed pairing: who the clinic is, where to reach it, and the
     * credential it will authenticate with.
     *
     * <p>Re-pairing an already-paired pharmacy is allowed and replaces everything.
     * That is the recovery path for a clinic that lost its secret — the alternative,
     * refusing, would leave a link nobody can use and nobody can rebuild.
     *
     * @param apiSecretHash the SHA-256 of the secret half; the plaintext is returned
     *                      to the caller once and deliberately never stored.
     */
    public void pairEmrClinic(String clinicExternalId, String clinicName, String callbackUrl,
                              String linkId, String apiKey, String apiSecretHash) {
        this.emrClinicExternalId = clinicExternalId;
        this.emrClinicName = clinicName;
        this.emrCallbackUrl = callbackUrl;
        this.emrClinicLinkId = linkId;
        this.emrApiKey = apiKey;
        this.emrApiSecretHash = apiSecretHash;
        this.emrPairedAt = Instant.now();
        if (this.emrConnectedAt == null) {
            this.emrConnectedAt = Instant.now();
        }
    }

    /** True when this pharmacy authenticates a clinic by API key rather than per-request HMAC. */
    public boolean isEmrPaired() {
        return emrApiKey != null && emrApiSecretHash != null;
    }

    /**
     * True when dispensing callbacks for this pharmacy are signed the clinic's way.
     * Derived from holding the clinic's webhook secret rather than from a stored flag,
     * because that secret is the thing the signature is made with.
     */
    public boolean usesClinicCallbackDialect() {
        return emrWebhookSecretCiphertext != null
                && emrWebhookSecretIv != null
                && emrWebhookSecretTag != null;
    }

    public boolean isActive() { return isActive; }

    public TenantStatus getTenantStatus() { return tenantStatus; }

    /** Platform-admin status change: sets the tenant status and active flag together. */
    public void applyStatus(TenantStatus status, boolean active) {
        this.tenantStatus = status;
        this.isActive = active;
    }
}
