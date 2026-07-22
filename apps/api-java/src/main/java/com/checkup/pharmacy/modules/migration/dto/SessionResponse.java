package com.checkup.pharmacy.modules.migration.dto;

import com.checkup.pharmacy.common.enums.MigrationSessionStatus;
import com.checkup.pharmacy.modules.migration.MigrationSession;

import java.util.List;
import java.util.Map;

public record SessionResponse(String id, MigrationSessionStatus status, String sourceSoftware,
                              List<String> completedSteps, String currentStep, Map<String, String> columnMappings,
                              List<ImportJobResponse> importJobs) {

    public static SessionResponse from(MigrationSession s, List<ImportJobResponse> jobs) {
        return new SessionResponse(s.getId(), s.getStatus(), s.getSourceSoftware(),
                List.of(s.getCompletedSteps()), s.getCurrentStep(), s.getColumnMappings(), jobs);
    }
}
