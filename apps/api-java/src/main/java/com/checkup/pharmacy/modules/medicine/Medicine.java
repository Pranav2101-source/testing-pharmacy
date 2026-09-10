package com.checkup.pharmacy.modules.medicine;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.PackSizeConfidence;
import com.checkup.pharmacy.common.enums.PackSizeSource;
import com.checkup.pharmacy.common.util.Cuid;
import com.checkup.pharmacy.common.util.PackSizeEvidence;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * The shared medicine catalog (table "medicines") — platform-wide, NOT scoped to
 * a pharmacy. OWNER/MANAGER may add a new catalog entry (the catalog grows as
 * pharmacies encounter medicines it's missing) but not CASHIER/PHARMACIST; only
 * PLATFORM_ADMIN may edit or deactivate an existing entry, since that affects
 * every tenant. See {@link com.checkup.pharmacy.modules.medicine.MedicineController}.
 *
 * Per-pharmacy customization (GST rate, standing discount) lives in
 * {@link PharmacyMedicineOverride}, never on this row.
 *
 * Only the columns the catalog UI uses today are mapped (brandId, categoryId,
 * boxSize, catalogMrp are follow-up work — see BACKLOG.md).
 */
@Entity
@Table(name = "medicines")
public class Medicine extends BaseEntity {

    @Column(name = "name")
    private String name;

    @Column(name = "genericName")
    private String genericName;

    @Column(name = "manufacturer")
    private String manufacturer;

    @Column(name = "composition")
    private String composition;

    @Column(name = "category")
    private String category;

    @Column(name = "schedule")
    private String schedule;

    @Column(name = "hsnCode")
    private String hsnCode;

    @Column(name = "gstRate")
    private BigDecimal gstRate;

    @Column(name = "form")
    private String form;

    @Column(name = "strength")
    private String strength;

    @Column(name = "unit")
    private String unit;

    @Column(name = "packSize")
    private String packSize;

    /**
     * Structured pack multiple — base units (tablets/capsules/mL) in one sellable
     * pack. The authoritative figure for loose ("cut strip") dispensing and
     * per-piece pricing; {@link #packSize} stays as the free-text label. NULL until
     * a platform admin classifies the medicine — loose sale is refused without it.
     */
    @Column(name = "unitsPerPack")
    private Integer unitsPerPack;

    /** TABLET | CAPSULE | ML | GM | EACH — the smallest dispensable unit. Label only for now. */
    @Column(name = "baseUnit")
    private String baseUnit;

    /**
     * How far {@link #unitsPerPack} may be trusted — see {@link PackSizeEvidence}.
     *
     * <p>NULL exactly when {@code unitsPerPack} is NULL; a database trigger enforces that
     * invariant for every writer, including this one. A write that reaches the table without
     * going through {@link MedicineService} is forced to {@code UNVERIFIED} / {@code RAW_WRITE}
     * by the same trigger, so an unaudited pack size is what a bad datum lands on by default
     * rather than a state something has to remember to set.
     */
    @Column(name = "packSizeConfidence")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private PackSizeConfidence packSizeConfidence;

    /** When a human last confirmed the pack size against a physical pack. Set only alongside VERIFIED. */
    @Column(name = "packSizeVerifiedAt")
    private Instant packSizeVerifiedAt;

    @Column(name = "packSizeSource")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private PackSizeSource packSizeSource;

    @Column(name = "isActive")
    private boolean isActive = true;

    @Column(name = "barcode")
    private String barcode;

    protected Medicine() {
        // Required by JPA.
    }

    public static Medicine create(String name, BigDecimal gstRate) {
        Medicine m = new Medicine();
        m.assignId(Cuid.generate());
        m.name = name;
        m.gstRate = gstRate;
        m.isActive = true;
        return m;
    }

    public void applyFields(String genericName, String manufacturer, String composition, String category,
                            String schedule, String hsnCode, BigDecimal gstRate, String form,
                            String strength, String unit, String packSize) {
        this.genericName = genericName;
        this.manufacturer = manufacturer;
        this.composition = composition;
        this.category = category;
        this.schedule = schedule;
        this.hsnCode = hsnCode;
        this.gstRate = gstRate;
        this.form = form;
        this.strength = strength;
        this.unit = unit;
        this.packSize = packSize;
    }

    public void rename(String name) {
        this.name = name;
    }

    public void activate() {
        this.isActive = true;
    }

    public void deactivate() {
        this.isActive = false;
    }

    public void setBarcode(String barcode) {
        this.barcode = barcode;
    }

    /** Narrow classification update — free-text product category + packaging unit only (see SetClassificationRequest). */
    public void setClassification(String category, String unit) {
        this.category = category;
        this.unit = unit;
    }

    /**
     * Sets the pack multiple and base unit used for loose dispensing. Platform-admin
     * only (this is a shared catalogue row). {@code unitsPerPack} null clears it,
     * which disables loose sale for the medicine everywhere.
     *
     * @throws IllegalArgumentException if {@code unitsPerPack} is given but not a
     *         sane count (1..100000). A pack of one is allowed as "the base unit is
     *         the pack"; loose sale still needs &gt; 1 (see {@link #isLooseCapable()}).
     */
    public void setPackaging(Integer unitsPerPack, String baseUnit) {
        if (unitsPerPack != null && (unitsPerPack < 1 || unitsPerPack > 100_000)) {
            throw new IllegalArgumentException(
                    "Units per pack must be between 1 and 100000 (got " + unitsPerPack + ").");
        }
        this.unitsPerPack = unitsPerPack;
        this.baseUnit = baseUnit;
    }

    /**
     * Records what is known about the pack size this row is now carrying.
     *
     * <p>Kept on the entity rather than left to the service to set three fields by hand,
     * because the three only make sense together: {@code packSizeVerifiedAt} is meaningless
     * without {@code VERIFIED}, and a stale timestamp under a downgraded confidence would read
     * as "checked" forever. Every call rewrites all three, so a pack size that stops being
     * corroborated stops looking corroborated.
     *
     * <p>Call it AFTER {@link #setPackaging}: with no pack multiple on the row there is nothing
     * to be confident about, and the whole assessment is cleared rather than stored against a
     * number that is not there.
     *
     * @param now the confirmation instant, used only when the verdict is VERIFIED
     */
    public void applyPackSizeEvidence(PackSizeEvidence evidence, Instant now) {
        if (unitsPerPack == null || evidence.confidence() == null) {
            this.packSizeConfidence = null;
            this.packSizeVerifiedAt = null;
            this.packSizeSource = null;
            return;
        }
        this.packSizeConfidence = evidence.confidence();
        this.packSizeSource = evidence.source();
        // Re-stamped on every VERIFIED write, not preserved: "confirmed in March" tells a
        // pharmacist something a sticky first-ever-confirmation date does not.
        this.packSizeVerifiedAt = evidence.isVerified() ? now : null;
    }

    /**
     * Drops the pack size into quarantine on the strength of what pharmacists actually
     * dispensed — see {@link PackSizeReviewService}.
     *
     * <p>Separate from {@link #applyPackSizeEvidence} because the evidence is of a different
     * kind. That method reasons about the medicine's own record; this one is the counter
     * answering back, and it is the only path that can reach {@code DISPUTED} after Phase 2
     * made the service write path reject it outright.
     *
     * <p>Notably it does NOT touch {@link #unitsPerPack}. The number stays exactly as it was,
     * wrong or not: billing must keep working while a human is found, and a quorum of lower
     * bounds is not something to overwrite a catalogue with. The confidence is the whole
     * change — the value is now labelled untrustworthy, and every screen that renders the
     * badge says so.
     *
     * <p>{@code packSizeSource} is left alone as well: where the bad number came from is
     * precisely what a reviewer needs, and overwriting it with the fact that it is disputed
     * would destroy the trail at the moment somebody starts following it.
     */
    public void quarantinePackSize() {
        if (unitsPerPack == null) {
            return; // nothing classified — an absence is not a contradiction
        }
        this.packSizeConfidence = PackSizeConfidence.DISPUTED;
        this.packSizeVerifiedAt = null;
    }

    /** True when this medicine can be broken into individual pieces (a real pack multiple exists). */
    public boolean isLooseCapable() {
        return unitsPerPack != null && unitsPerPack > 1;
    }

    public String getName() { return name; }

    public String getGenericName() { return genericName; }

    public String getManufacturer() { return manufacturer; }

    public String getComposition() { return composition; }

    public String getCategory() { return category; }

    public String getSchedule() { return schedule; }

    public String getHsnCode() { return hsnCode; }

    public BigDecimal getGstRate() { return gstRate; }

    public String getForm() { return form; }

    public String getStrength() { return strength; }

    public String getUnit() { return unit; }

    public String getPackSize() { return packSize; }

    public Integer getUnitsPerPack() { return unitsPerPack; }

    public String getBaseUnit() { return baseUnit; }

    public PackSizeConfidence getPackSizeConfidence() { return packSizeConfidence; }

    public Instant getPackSizeVerifiedAt() { return packSizeVerifiedAt; }

    public PackSizeSource getPackSizeSource() { return packSizeSource; }

    public boolean isActive() { return isActive; }

    public String getBarcode() { return barcode; }
}
