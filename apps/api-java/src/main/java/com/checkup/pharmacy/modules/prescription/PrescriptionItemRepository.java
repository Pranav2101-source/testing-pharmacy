package com.checkup.pharmacy.modules.prescription;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PrescriptionItemRepository extends JpaRepository<PrescriptionItem, String> {

    List<PrescriptionItem> findByPrescriptionId(String prescriptionId);

    void deleteByPrescriptionId(String prescriptionId);
}
