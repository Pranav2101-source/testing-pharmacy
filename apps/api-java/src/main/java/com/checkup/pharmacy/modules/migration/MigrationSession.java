package com.checkup.pharmacy.modules.migration;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.MigrationSessionStatus;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.Map;

/** One onboarding-import wizard run (table "migration_sessions"). */
@Entity
@Table(name = "migration_sessions")
public class MigrationSession extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "status")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private MigrationSessionStatus status = MigrationSessionStatus.IN_PROGRESS;

    @Column(name = "sourceSoftware")
    private String sourceSoftware;

    @Column(name = "completedSteps")
    @JdbcTypeCode(SqlTypes.ARRAY)
    private String[] completedSteps = new String[0];

    @Column(name = "currentStep")
    private String currentStep;

    @Column(name = "columnMappings")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, String> columnMappings;

    @Column(name = "notes")
    private String notes;

    @Column(name = "createdBy")
    private String createdBy;

    protected MigrationSession() {
        // Required by JPA.
    }

    public static MigrationSession create(String pharmacyId, String createdBy, String sourceSoftware, String notes) {
        MigrationSession s = new MigrationSession();
        s.assignId(Cuid.generate());
        s.pharmacyId = pharmacyId;
        s.createdBy = createdBy;
        s.sourceSoftware = sourceSoftware;
        s.notes = notes;
        return s;
    }

    public void setColumnMappings(Map<String, String> columnMappings) {
        this.columnMappings = columnMappings;
        this.currentStep = "column-mapping";
    }

    public void markStepCompleted(String step) {
        this.currentStep = step;
        java.util.Set<String> steps = new java.util.LinkedHashSet<>(java.util.List.of(completedSteps));
        steps.add(step);
        this.completedSteps = steps.toArray(new String[0]);
    }

    public void complete() {
        this.status = MigrationSessionStatus.COMPLETED;
        this.currentStep = "summary";
    }

    public void rollBack() {
        this.status = MigrationSessionStatus.ROLLED_BACK;
        this.completedSteps = new String[0];
    }

    public String getPharmacyId() { return pharmacyId; }

    public MigrationSessionStatus getStatus() { return status; }

    public String getSourceSoftware() { return sourceSoftware; }

    public String[] getCompletedSteps() { return completedSteps; }

    public String getCurrentStep() { return currentStep; }

    public Map<String, String> getColumnMappings() { return columnMappings; }

    public String getNotes() { return notes; }

    public String getCreatedBy() { return createdBy; }
}
