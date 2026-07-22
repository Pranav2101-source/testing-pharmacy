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

    @Column(name = "notes")
    private String notes;

    @Column(name = "createdAt")
    private Instant createdAt;

    @Column(name = "updatedAt")
    private Instant updatedAt;

    protected PharmacyMedicineOverride() {
        // Required by JPA.
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

    public String getPharmacyId() { return id.getPharmacyId(); }

    public String getMedicineId() { return id.getMedicineId(); }

    public BigDecimal getGstRate() { return gstRate; }

    public BigDecimal getDefaultDiscountPct() { return defaultDiscountPct; }

    public String getNotes() { return notes; }
}
