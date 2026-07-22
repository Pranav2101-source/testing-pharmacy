package com.checkup.pharmacy.modules.migration;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.time.Instant;

/**
 * Persists a CSV medicine-name value's confirmed mapping to the catalog (table
 * "medicine_mappings") — reused silently across future imports for the same
 * pharmacy, unlike {@link MigrationCreatedRecord} which is session-scoped.
 * {@code csvValue} is always the lowercased+trimmed CSV value.
 */
@Entity
@Table(name = "medicine_mappings", uniqueConstraints = @UniqueConstraint(columnNames = {"pharmacyId", "csvValue"}))
public class MedicineMapping extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "csvValue")
    private String csvValue;

    @Column(name = "medicineId")
    private String medicineId;

    @Column(name = "isNew")
    private boolean isNewMedicine = false;

    @Column(name = "confidence")
    private Float confidence;

    @Column(name = "confirmedAt")
    private Instant confirmedAt;

    @Column(name = "confirmedBy")
    private String confirmedBy;

    protected MedicineMapping() {
        // Required by JPA.
    }

    public static MedicineMapping create(String pharmacyId, String csvValue) {
        MedicineMapping m = new MedicineMapping();
        m.assignId(Cuid.generate());
        m.pharmacyId = pharmacyId;
        m.csvValue = csvValue;
        return m;
    }

    public void confirm(String medicineId, boolean isNew, String confirmedBy) {
        this.medicineId = medicineId;
        this.isNewMedicine = isNew;
        this.confirmedAt = Instant.now();
        this.confirmedBy = confirmedBy;
    }

    public void setMedicineId(String medicineId) {
        this.medicineId = medicineId;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getCsvValue() { return csvValue; }

    public String getMedicineId() { return medicineId; }

    public boolean isNewMedicine() { return isNewMedicine; }

    public Float getConfidence() { return confidence; }

    public void setConfidence(Float confidence) {
        this.confidence = confidence;
    }

    public Instant getConfirmedAt() { return confirmedAt; }

    public String getConfirmedBy() { return confirmedBy; }
}
