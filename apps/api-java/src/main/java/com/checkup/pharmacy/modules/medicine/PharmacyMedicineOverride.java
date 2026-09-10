package com.checkup.pharmacy.modules.medicine;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.MapsId;
import jakarta.persistence.Table;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * One pharmacy's customization of one catalog medicine (table
 * "pharmacy_medicine_overrides"). A null field means "use the catalog value" —
 * this row only ever stores the delta, never a full copy of the medicine.
 */
@Entity
@Table(name = "pharmacy_medicine_overrides")
public class PharmacyMedicineOverride {

    @EmbeddedId
    private PharmacyMedicineOverrideId id;

    @Column(name = "gstRate")
    private BigDecimal gstRate;

    @Column(name = "defaultDiscountPct")
    private BigDecimal defaultDiscountPct;

    /**
     * This pharmacy may break a pack of this medicine and sell loose pieces at the
     * POS. Only meaningful when the effective unitsPerPack (this override's, else
     * the catalogue's) is &gt; 1.
     */
    @Column(name = "allowLooseSale")
    private boolean allowLooseSale;

    /** New POS lines for this medicine start as LOOSE (a shop that cuts every strip). */
    @Column(name = "looseByDefault")
    private boolean looseByDefault;

    /** Set when the pharmacist has checked the pack size against a real strip. */
    @Column(name = "looseConfirmedAt")
    private Instant looseConfirmedAt;

    /** Per-pharmacy pack size — wins over {@code Medicine.unitsPerPack} when set. */
    @Column(name = "unitsPerPack")
    private Integer unitsPerPack;

    @Column(name = "notes")
    private String notes;

    @Column(name = "createdAt")
    private Instant createdAt;

    @Column(name = "updatedAt")
    private Instant updatedAt;

    protected PharmacyMedicineOverride() {
        // Required by JPA.
    }

    /**
     * The pack multiple that actually applies at one pharmacy: this override's own
     * {@code unitsPerPack} when it has set one, else the shared catalogue's. Null when
     * neither has classified the medicine — which is NOT the same as 1, because a
     * medicine with no pack multiple can never be sold loose (see
     * {@code DispensingService.catalogueContext}).
     *
     * <p>The COALESCE documented on {@code schema.prisma}'s {@code
     * PharmacyMedicineOverride.unitsPerPack} ("Billing uses COALESCE(this,
     * medicine.unitsPerPack)"), in one place. Every read of a pack multiple for a
     * catalogue medicine must go through here or {@link #effectivePackMultiple}:
     * {@code stockCheck} and the EMR medicine-match preview each used the raw
     * {@code Medicine.unitsPerPack} instead, so a pharmacy that had classified a pack
     * size through its own override (the ONLY way to classify one, since the catalogue
     * is platform-admin-owned) saw the same shelf reported as e.g. 1050 on the
     * prescription triage panel and 10500 in the billing cart.
     *
     * @param override this pharmacy's override row, or null when it has none
     * @param medicine the shared catalogue record; null yields the override's own value
     */
    public static Integer effectiveUnitsPerPack(PharmacyMedicineOverride override, Medicine medicine) {
        if (override != null && override.getUnitsPerPack() != null) {
            return override.getUnitsPerPack();
        }
        return medicine == null ? null : medicine.getUnitsPerPack();
    }

    /**
     * {@link #effectiveUnitsPerPack} floored at 1, for piece-count arithmetic
     * ({@code packs * multiple + looseUnits}). An unclassified medicine counts one
     * piece per pack, which is what every stock total did before pack multiples existed.
     */
    public static int effectivePackMultiple(PharmacyMedicineOverride override, Medicine medicine) {
        Integer upp = effectiveUnitsPerPack(override, medicine);
        return upp != null && upp > 0 ? upp : 1;
    }

    public static PharmacyMedicineOverride create(String pharmacyId, String medicineId) {
        PharmacyMedicineOverride o = new PharmacyMedicineOverride();
        o.id = new PharmacyMedicineOverrideId(pharmacyId, medicineId);
        Instant now = Instant.now();
        o.createdAt = now;
        o.updatedAt = now;
        return o;
    }

    public void update(BigDecimal gstRate, BigDecimal defaultDiscountPct, String notes) {
        this.gstRate = gstRate;
        this.defaultDiscountPct = defaultDiscountPct;
        this.notes = notes;
        this.updatedAt = Instant.now();
    }

    /** Toggles cut-strip selling for this pharmacy + medicine. Separate setter — a narrow POS-settings action, not the GST/discount override form. */
    public void setAllowLooseSale(boolean allowLooseSale) {
        this.allowLooseSale = allowLooseSale;
        this.updatedAt = Instant.now();
    }

    /**
     * Sets every loose-POS field at once. {@code unitsPerPack} null falls back to the
     * catalogue value at billing time; a non-null value must be 2..100000 (checked by
     * the caller and the DB). {@code confirmed} stamps {@link #looseConfirmedAt} the
     * first time it is true and never clears it.
     */
    /** Two-field form — leaves looseByDefault false and does not stamp confirmation. */
    public void applyLoosePos(boolean allowLooseSale, Integer unitsPerPack) {
        applyLoosePos(allowLooseSale, unitsPerPack, false, false);
    }

    public void applyLoosePos(boolean allowLooseSale, Integer unitsPerPack, boolean looseByDefault, boolean confirmed) {
        this.allowLooseSale = allowLooseSale;
        this.unitsPerPack = unitsPerPack;
        this.looseByDefault = looseByDefault;
        if (confirmed && this.looseConfirmedAt == null) {
            this.looseConfirmedAt = Instant.now();
        }
        this.updatedAt = Instant.now();
    }

    public String getPharmacyId() { return id.getPharmacyId(); }

    public String getMedicineId() { return id.getMedicineId(); }

    public BigDecimal getGstRate() { return gstRate; }

    public BigDecimal getDefaultDiscountPct() { return defaultDiscountPct; }

    public boolean isAllowLooseSale() { return allowLooseSale; }

    public boolean isLooseByDefault() { return looseByDefault; }

    public Instant getLooseConfirmedAt() { return looseConfirmedAt; }

    public Integer getUnitsPerPack() { return unitsPerPack; }

    public String getNotes() { return notes; }
}
