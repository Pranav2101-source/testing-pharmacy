package com.checkup.pharmacy.modules.migration;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface MedicineMappingRepository extends JpaRepository<MedicineMapping, String> {

    Optional<MedicineMapping> findByPharmacyIdAndCsvValue(String pharmacyId, String csvValue);

    List<MedicineMapping> findByPharmacyIdAndCsvValueIn(String pharmacyId, Collection<String> csvValues);
}
