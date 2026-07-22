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

    public boolean isActive() { return isActive; }

    public String getBarcode() { return barcode; }
}
