package com.checkup.pharmacy.modules.audit.dto;

public record AuditKpisResponse(long totalEvents, long failedActions, long securityAlerts, long loginEvents) {
}
