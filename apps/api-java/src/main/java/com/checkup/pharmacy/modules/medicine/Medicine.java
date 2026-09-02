package com.checkup.pharmacy.modules.medicine;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.math.BigDecimal;

/**
 * The shared medicine catalog (table "medicines") — platform-wide, NOT scoped to
 * a pharmacy. Any authenticated user may add a new catalog entry (the catalog
 * grows as pharmacies encounter medicines it's missing); only PLATFORM_ADMIN may
 * edit or deactivate an existing entry, since that affects every tenant.
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

    public boolean isActive() { return isActive; }

    public String getBarcode() { return barcode; }
}
