package com.checkup.pharmacy.modules.migration.dto;

import com.checkup.pharmacy.common.enums.MigrationEntityType;

import java.util.List;

public record CommitResult(MigrationEntityType entityType, int totalRows, int successRows, int failedRows,
                           Integer skippedRows, List<RowIssue> errors, String jobId, boolean async) {
}
