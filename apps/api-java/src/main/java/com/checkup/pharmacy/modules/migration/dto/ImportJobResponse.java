package com.checkup.pharmacy.modules.migration.dto;

import com.checkup.pharmacy.common.enums.ImportJobStatus;
import com.checkup.pharmacy.common.enums.MigrationEntityType;
import com.checkup.pharmacy.modules.migration.MigrationImportJob;

import java.util.List;

public record ImportJobResponse(String id, MigrationEntityType entityType, ImportJobStatus status, int totalRows,
                                int processedRows, int successRows, int failedRows, List<RowIssue> errors) {

    public static ImportJobResponse from(MigrationImportJob j) {
        return new ImportJobResponse(j.getId(), j.getEntityType(), j.getStatus(), j.getTotalRows(),
                j.getProcessedRows(), j.getSuccessRows(), j.getFailedRows(), j.getErrors());
    }
}
