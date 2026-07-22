package com.checkup.pharmacy.modules.medicine;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PharmacyMedicineOverrideRepository
        extends JpaRepository<PharmacyMedicineOverride, PharmacyMedicineOverrideId> {

    List<PharmacyMedicineOverride> findByIdPharmacyId(String pharmacyId);

    Optional<PharmacyMedicineOverride> findByIdPharmacyIdAndIdMedicineId(String pharmacyId, String medicineId);

    void deleteByIdPharmacyIdAndIdMedicineId(String pharmacyId, String medicineId);
}
