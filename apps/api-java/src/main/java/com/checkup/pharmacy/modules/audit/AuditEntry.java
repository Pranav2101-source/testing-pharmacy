package com.checkup.pharmacy.modules.audit;

import com.checkup.pharmacy.common.enums.AuditModule;
import com.checkup.pharmacy.common.enums.AuditSeverity;
import com.checkup.pharmacy.common.enums.AuditStatus;

import java.util.Map;

/**
 * Builder for one {@link AuditService#log} call. pharmacyId/userId/userEmail are
 * explicit here (not read from {@code TenantContext}) because several call sites
 * — login failures, a newly self-registered owner, an admin acting on someone
 * else's tenant — log an event about a principal that isn't (or isn't yet, or
 * isn't only) the caller's own security context.
 */
public final class AuditEntry {

    final AuditModule module;
    final String action;
    final String entity;
    String pharmacyId;
    String userId;
    String userEmail;
    String entityId;
    String resourceName;
    Map<String, Object> oldData;
    Map<String, Object> newData;
    AuditSeverity severity = AuditSeverity.INFO;
    AuditStatus status = AuditStatus.SUCCESS;

    private AuditEntry(AuditModule module, String action, String entity) {
        this.module = module;
        this.action = action;
        this.entity = entity;
    }

    public static AuditEntry of(AuditModule module, String action, String entity) {
        return new AuditEntry(module, action, entity);
    }

    public AuditEntry pharmacyId(String v) { this.pharmacyId = v; return this; }

    public AuditEntry userId(String v) { this.userId = v; return this; }

    public AuditEntry userEmail(String v) { this.userEmail = v; return this; }

    public AuditEntry entityId(String v) { this.entityId = v; return this; }

    public AuditEntry resourceName(String v) { this.resourceName = v; return this; }

    public AuditEntry oldData(Map<String, Object> v) { this.oldData = v; return this; }

    public AuditEntry newData(Map<String, Object> v) { this.newData = v; return this; }

    public AuditEntry severity(AuditSeverity v) { this.severity = v; return this; }

    public AuditEntry status(AuditStatus v) { this.status = v; return this; }
}
