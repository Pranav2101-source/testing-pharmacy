package com.checkup.pharmacy.modules.medicine;

import jakarta.persistence.Embeddable;

import java.io.Serializable;
import java.util.Objects;

/** Composite key for {@link PharmacyMedicineOverride}: (pharmacyId, medicineId). */
@Embeddable
public class PharmacyMedicineOverrideId implements Serializable {

    private String pharmacyId;
    private String medicineId;

    protected PharmacyMedicineOverrideId() {
        // Required by JPA.
    }

    public PharmacyMedicineOverrideId(String pharmacyId, String medicineId) {
        this.pharmacyId = pharmacyId;
        this.medicineId = medicineId;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getMedicineId() { return medicineId; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof PharmacyMedicineOverrideId that)) return false;
        return Objects.equals(pharmacyId, that.pharmacyId) && Objects.equals(medicineId, that.medicineId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(pharmacyId, medicineId);
    }
}
