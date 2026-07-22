package com.checkup.pharmacy.modules.stockaudit;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.AuditSessionStatus;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * Maps the Prisma `StockAuditSession` model (table "stock_audit_sessions") —
 * a physical stock-count session. Snapshots current {@code Inventory.quantity}
 * into {@link StockAuditItem} rows at creation; approving the session applies
 * variances as ADJUSTMENT movements (see {@link StockAuditService#approveSession}).
 */
@Entity
@Table(name = "stock_audit_sessions")
public class StockAuditSession extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "sessionNumber")
    private String sessionNumber;

    @Column(name = "status")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private AuditSessionStatus status = AuditSessionStatus.DRAFT;

    @Column(name = "notes")
    private String notes;

    @Column(name = "startedAt")
    private Instant startedAt;

    @Column(name = "completedAt")
    private Instant completedAt;

    @Column(name = "approvedAt")
    private Instant approvedAt;

    @Column(name = "approvedBy")
    private String approvedBy;

    @Column(name = "createdBy")
    private String createdBy;

    protected StockAuditSession() {
        // Required by JPA.
    }

    public static StockAuditSession create(String pharmacyId, String sessionNumber, String createdBy, String notes) {
        StockAuditSession s = new StockAuditSession();
        s.assignId(Cuid.generate());
        s.pharmacyId = pharmacyId;
        s.sessionNumber = sessionNumber;
        s.createdBy = createdBy;
        s.notes = notes;
        s.status = AuditSessionStatus.DRAFT;
        return s;
    }

    public void start() {
        this.status = AuditSessionStatus.IN_PROGRESS;
        this.startedAt = Instant.now();
    }

    public void reopen() {
        this.status = AuditSessionStatus.IN_PROGRESS;
        this.completedAt = null;
    }

    public void complete(String notes) {
        this.status = AuditSessionStatus.COMPLETED;
        this.completedAt = Instant.now();
        if (notes != null && !notes.isBlank()) {
            this.notes = notes;
        }
    }

    public void approve(String approvedBy) {
        this.status = AuditSessionStatus.APPROVED;
        this.approvedAt = Instant.now();
        this.approvedBy = approvedBy;
    }

    public void cancel() {
        this.status = AuditSessionStatus.CANCELLED;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getSessionNumber() { return sessionNumber; }

    public AuditSessionStatus getStatus() { return status; }

    public String getNotes() { return notes; }

    public Instant getStartedAt() { return startedAt; }

    public Instant getCompletedAt() { return completedAt; }

    public Instant getApprovedAt() { return approvedAt; }

    public String getApprovedBy() { return approvedBy; }

    public String getCreatedBy() { return createdBy; }
}
