package com.checkup.pharmacy.modules.migration;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.ImportJobStatus;
import com.checkup.pharmacy.common.enums.MigrationEntityType;
import com.checkup.pharmacy.common.util.Cuid;
import com.checkup.pharmacy.modules.migration.dto.RowIssue;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.List;

/**
 * One entity-type import within a {@link MigrationSession} (table "migration_import_jobs").
 * The Java rebuild has no pg-boss/background-queue equivalent yet, so every job here runs
 * and completes synchronously within the request that created it — {@code status} goes
 * straight from PENDING to COMPLETED/FAILED, never PROCESSING. The row still exists (rather
 * than skipping job-tracking entirely) because {@code GET /migration/history} reads from it.
 */
@Entity
@Table(name = "migration_import_jobs")
public class MigrationImportJob extends BaseEntity {

    @Column(name = "sessionId")
    private String sessionId;

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "entityType")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private MigrationEntityType entityType;

    @Column(name = "status")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private ImportJobStatus status = ImportJobStatus.PENDING;

    @Column(name = "totalRows")
    private int totalRows;

    @Column(name = "processedRows")
    private int processedRows;

    @Column(name = "successRows")
    private int successRows;

    @Column(name = "failedRows")
    private int failedRows;

    @Column(name = "errors")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<RowIssue> errors = List.of();

    @Column(name = "startedAt")
    private Instant startedAt;

    @Column(name = "completedAt")
    private Instant completedAt;

    protected MigrationImportJob() {
        // Required by JPA.
    }

    public static MigrationImportJob create(String sessionId, String pharmacyId, MigrationEntityType entityType,
                                            int totalRows) {
        MigrationImportJob j = new MigrationImportJob();
        j.assignId(Cuid.generate());
        j.sessionId = sessionId;
        j.pharmacyId = pharmacyId;
        j.entityType = entityType;
        j.totalRows = totalRows;
        j.startedAt = Instant.now();
        j.status = ImportJobStatus.PROCESSING;
        return j;
    }

    public void complete(int processedRows, int successRows, int failedRows, List<RowIssue> errors) {
        this.processedRows = processedRows;
        this.successRows = successRows;
        this.failedRows = failedRows;
        this.errors = errors;
        this.status = failedRows > 0 && successRows == 0 && processedRows > 0
                ? ImportJobStatus.FAILED : ImportJobStatus.COMPLETED;
        this.completedAt = Instant.now();
    }

    public String getSessionId() { return sessionId; }

    public String getPharmacyId() { return pharmacyId; }

    public MigrationEntityType getEntityType() { return entityType; }

    public ImportJobStatus getStatus() { return status; }

    public int getTotalRows() { return totalRows; }

    public int getProcessedRows() { return processedRows; }

    public int getSuccessRows() { return successRows; }

    public int getFailedRows() { return failedRows; }

    public List<RowIssue> getErrors() { return errors; }

    public Instant getStartedAt() { return startedAt; }

    public Instant getCompletedAt() { return completedAt; }
}
