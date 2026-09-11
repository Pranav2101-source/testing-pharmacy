package com.checkup.pharmacy.modules.medicine;

import com.checkup.pharmacy.common.enums.PackSizeConfidence;
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

    /**
     * The exact pack size this pharmacy last checked against a physical pack. Unlike
     * {@link #looseConfirmedAt} it is re-stamped on every confirmation, so it always names the
     * number that was checked — see {@link #effectivePackSizeConfidence}.
     */
    @Column(name = "confirmedUnitsPerPack")
    private Integer confirmedUnitsPerPack;

    /** When {@link #confirmedUnitsPerPack} was last confirmed. */
    @Column(name = "packSizeConfirmedAt")
    private Instant packSizeConfirmedAt;

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

    /**
     * How far the pack size THIS pharmacy bills by may be trusted — the trust state of the
     * number {@link #effectiveUnitsPerPack} returns, which is not always the catalogue's.
     *
     * <p>The catalogue's {@code packSizeConfidence} describes the catalogue's own number. When
     * this pharmacy's override supplies the divisor instead, that verdict is about a number
     * billing is not using; and when a pharmacist here has checked the number billing IS using,
     * the catalogue cannot know it. Reporting the catalogue's state regardless meant a pharmacist
     * could follow the badge, check the bottle, confirm it — and come back to the same badge.
     *
     * <ul>
     *   <li><b>VERIFIED</b> when this pharmacy confirmed exactly the number in use. A comparison,
     *       not a flag: once the catalogue or the override moves, the confirmation stops matching
     *       and trust falls back below without anyone having to remember to clear it.</li>
     *   <li>Otherwise, when the number in use IS the catalogue's, the catalogue's own state —
     *       including a quorum's DISPUTED.</li>
     *   <li>Otherwise the number is this pharmacy's own and nobody has checked it: UNVERIFIED.</li>
     * </ul>
     *
     * <p>Never writes anything back to the catalogue: one shop holding a bottle vouches for its
     * own billing, not for a shared value every other pharmacy divides by.
     *
     * @return null when nothing has classified the pack size — which is not the same as UNVERIFIED
     */
    public static PackSizeConfidence effectivePackSizeConfidence(PharmacyMedicineOverride override,
                                                                 Medicine medicine) {
        Integer inUse = effectiveUnitsPerPack(override, medicine);
        if (inUse == null) {
            return null;
        }
        if (override != null && inUse.equals(override.confirmedUnitsPerPack)) {
            return PackSizeConfidence.VERIFIED;
        }
        if (medicine != null && inUse.equals(medicine.getUnitsPerPack())) {
            // The trigger guarantees a classified catalogue row carries a confidence; a row that
            // somehow does not is, by definition, one nobody vouched for.
            return medicine.getPackSizeConfidence() != null
                    ? medicine.getPackSizeConfidence() : PackSizeConfidence.UNVERIFIED;
        }
        return PackSizeConfidence.UNVERIFIED;
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

    /**
     * Records that a pharmacist here has just checked {@code unitsPerPack} against a physical
     * pack. Re-stamped every time, never sticky: the point is to remember WHICH number was
     * checked, so a later change to either the override or the catalogue is visibly unchecked.
     */
    public void confirmPackSize(int unitsPerPack, Instant when) {
        this.confirmedUnitsPerPack = unitsPerPack;
        this.packSizeConfirmedAt = when;
        this.updatedAt = when;
    }

    public String getPharmacyId() { return id.getPharmacyId(); }

    public String getMedicineId() { return id.getMedicineId(); }

    public BigDecimal getGstRate() { return gstRate; }

    public BigDecimal getDefaultDiscountPct() { return defaultDiscountPct; }

    public boolean isAllowLooseSale() { return allowLooseSale; }

    public boolean isLooseByDefault() { return looseByDefault; }

    public Instant getLooseConfirmedAt() { return looseConfirmedAt; }

    public Integer getUnitsPerPack() { return unitsPerPack; }

    public Integer getConfirmedUnitsPerPack() { return confirmedUnitsPerPack; }

    public Instant getPackSizeConfirmedAt() { return packSizeConfirmedAt; }

    public String getNotes() { return notes; }
}
