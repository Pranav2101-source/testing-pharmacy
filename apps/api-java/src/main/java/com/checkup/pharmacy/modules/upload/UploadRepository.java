package com.checkup.pharmacy.modules.upload;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface UploadRepository extends JpaRepository<Upload, String> {

    long countByPharmacyId(String pharmacyId);

    Optional<Upload> findByIdAndPharmacyId(String id, String pharmacyId);
}
