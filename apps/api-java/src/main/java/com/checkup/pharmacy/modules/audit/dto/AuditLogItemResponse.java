package com.checkup.pharmacy.modules.audit.dto;

import com.checkup.pharmacy.common.enums.AuditModule;
import com.checkup.pharmacy.common.enums.AuditSeverity;
import com.checkup.pharmacy.common.enums.AuditStatus;
import com.checkup.pharmacy.modules.audit.AuditLog;

import java.time.Instant;
import java.util.Map;

/** Matches the frontend's AuditLogItem shape (platform/audit/audit.types.ts). */
public record AuditLogItemResponse(
        String id,
        String pharmacyId,
        String userId,
        String userEmail,
        AuditModule module,
        String action,
        String entity,
        String entityId,
        String resourceName,
        Map<String, Object> oldData,
        Map<String, Object> newData,
        String ipAddress,
        String userAgent,
        AuditSeverity severity,
        AuditStatus status,
        String requestId,
        Instant createdAt,
        UserRef user,
        PharmacyRef pharmacy
) {
    public record UserRef(String id, String name, String email) {
    }

    public record PharmacyRef(String id, String name) {
    }

    public static AuditLogItemResponse from(AuditLog a) {
        UserRef user = a.getUser() == null ? null
                : new UserRef(a.getUser().getId(), a.getUser().getName(), a.getUser().getEmail());
        PharmacyRef pharmacy = a.getPharmacy() == null ? null
                : new PharmacyRef(a.getPharmacy().getId(), a.getPharmacy().getName());
        return new AuditLogItemResponse(a.getId(), a.getPharmacyId(), a.getUserId(), a.getUserEmail(), a.getModule(),
                a.getAction(), a.getEntity(), a.getEntityId(), a.getResourceName(), a.getOldData(), a.getNewData(),
                a.getIpAddress(), a.getUserAgent(), a.getSeverity(), a.getStatus(), a.getRequestId(),
                a.getCreatedAt(), user, pharmacy);
    }
}
