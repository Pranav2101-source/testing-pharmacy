package com.checkup.pharmacy.modules.audit;

import com.checkup.pharmacy.common.domain.CreatedAtEntity;
import com.checkup.pharmacy.common.enums.AuditModule;
import com.checkup.pharmacy.common.enums.AuditSeverity;
import com.checkup.pharmacy.common.enums.AuditStatus;
import com.checkup.pharmacy.common.util.Cuid;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.user.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.Map;

/**
 * A single audit event (table "audit_logs"). Platform-admin-facing, not a
 * comprehensive per-CRUD trail — significant actions call
 * {@link AuditService#log} explicitly at the point of the write. Both
 * {@code pharmacyId} and {@code userId} are nullable: platform-level system
 * events (e.g. a tenant created before its first user exists) carry neither.
 */
@Entity
@Table(name = "audit_logs")
public class AuditLog extends CreatedAtEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "userId")
    private String userId;

    @Column(name = "userEmail")
    private String userEmail;

    @Column(name = "module")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private AuditModule module = AuditModule.SYSTEM;

    @Column(name = "action")
    private String action;

    @Column(name = "entity")
    private String entity;

    @Column(name = "entityId")
    private String entityId;

    @Column(name = "resourceName")
    private String resourceName;

    @Column(name = "oldData")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Object> oldData;

    @Column(name = "newData")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Object> newData;

    @Column(name = "ipAddress")
    private String ipAddress;

    @Column(name = "userAgent")
    private String userAgent;

    @Column(name = "severity")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private AuditSeverity severity = AuditSeverity.INFO;

    @Column(name = "status")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private AuditStatus status = AuditStatus.SUCCESS;

    @Column(name = "requestId")
    private String requestId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "userId", insertable = false, updatable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "pharmacyId", insertable = false, updatable = false)
    private Pharmacy pharmacy;

    protected AuditLog() {
        // Required by JPA.
    }

    public static AuditLog create(String pharmacyId, String userId, String userEmail, AuditModule module,
                                  String action, String entity, String entityId, String resourceName,
                                  Map<String, Object> oldData, Map<String, Object> newData, String ipAddress,
                                  String userAgent, AuditSeverity severity, AuditStatus status, String requestId) {
        AuditLog a = new AuditLog();
        a.assignId(Cuid.generate());
        a.pharmacyId = pharmacyId;
        a.userId = userId;
        a.userEmail = userEmail;
        a.module = module == null ? AuditModule.SYSTEM : module;
        a.action = action;
        a.entity = entity;
        a.entityId = entityId;
        a.resourceName = resourceName;
        a.oldData = oldData;
        a.newData = newData;
        a.ipAddress = ipAddress;
        a.userAgent = userAgent;
        a.severity = severity == null ? AuditSeverity.INFO : severity;
        a.status = status == null ? AuditStatus.SUCCESS : status;
        a.requestId = requestId;
        return a;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getUserId() { return userId; }

    public String getUserEmail() { return userEmail; }

    public AuditModule getModule() { return module; }

    public String getAction() { return action; }

    public String getEntity() { return entity; }

    public String getEntityId() { return entityId; }

    public String getResourceName() { return resourceName; }

    public Map<String, Object> getOldData() { return oldData; }

    public Map<String, Object> getNewData() { return newData; }

    public String getIpAddress() { return ipAddress; }

    public String getUserAgent() { return userAgent; }

    public AuditSeverity getSeverity() { return severity; }

    public AuditStatus getStatus() { return status; }

    public String getRequestId() { return requestId; }

    public User getUser() { return user; }

    public Pharmacy getPharmacy() { return pharmacy; }
}
