package com.checkup.pharmacy.modules.platform.tenant.dto;

import com.checkup.pharmacy.modules.audit.AuditLog;

import java.time.Instant;

/** One tenant audit-trail entry for the drawer's activity tab. */
public record TenantActivityItem(
        String id,
        String action,
        String entity,
        String module,
        String severity,
        String status,
        String resourceName,
        Instant createdAt,
        UserRef user) {

    public record UserRef(String name) {
    }

    public static TenantActivityItem from(AuditLog a) {
        UserRef user = a.getUser() != null ? new UserRef(a.getUser().getName()) : null;
        return new TenantActivityItem(
                a.getId(), a.getAction(), a.getEntity(),
                a.getModule() == null ? null : a.getModule().name(),
                a.getSeverity() == null ? null : a.getSeverity().name(),
                a.getStatus() == null ? null : a.getStatus().name(),
                a.getResourceName(), a.getCreatedAt(), user);
    }
}
