package com.checkup.pharmacy.modules.medicine;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PharmacyMedicineOverrideRepository
        extends JpaRepository<PharmacyMedicineOverride, PharmacyMedicineOverrideId> {

    List<PharmacyMedicineOverride> findByIdPharmacyId(String pharmacyId);

    /**
     * Which of these catalogue medicines any pharmacy has customised.
     *
     * <p>Cross-tenant on purpose — see InventoryRepository.findMedicineIdsInUse.
     */
    @org.springframework.data.jpa.repository.Query("SELECT DISTINCT o.id.medicineId FROM PharmacyMedicineOverride o WHERE o.id.medicineId IN :medicineIds")
    List<String> findMedicineIdsWithOverrides(@org.springframework.data.repository.query.Param("medicineIds") java.util.Collection<String> medicineIds);

    /**
     * Overrides for a specific set of medicines.
     *
     * <p>Billing and goods-receipt only ever care about the handful of medicines on the
     * document in front of them, but were loading {@link #findByIdPharmacyId} — every
     * override the pharmacy has ever set — and filtering in Java. A pharmacy that has
     * customised GST or pricing across its catalogue was reading thousands of rows on
     * the hottest write path in the product, once per sale.
     */
    List<PharmacyMedicineOverride> findByIdPharmacyIdAndIdMedicineIdIn(String pharmacyId,
                                                                       java.util.Collection<String> medicineIds);

    Optional<PharmacyMedicineOverride> findByIdPharmacyIdAndIdMedicineId(String pharmacyId, String medicineId);

    void deleteByIdPharmacyIdAndIdMedicineId(String pharmacyId, String medicineId);
}
