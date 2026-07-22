package com.checkup.pharmacy.modules.migration;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface MigrationSessionRepository extends JpaRepository<MigrationSession, String> {

    Optional<MigrationSession> findByIdAndPharmacyId(String id, String pharmacyId);

    List<MigrationSession> findByPharmacyIdOrderByCreatedAtDesc(String pharmacyId);
}
