package com.checkup.pharmacy.modules.migration;

import com.checkup.pharmacy.common.enums.MigrationEntityType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface MigrationCreatedRecordRepository extends JpaRepository<MigrationCreatedRecord, String> {

    List<MigrationCreatedRecord> findBySessionIdAndEntityType(String sessionId, MigrationEntityType entityType);
}
