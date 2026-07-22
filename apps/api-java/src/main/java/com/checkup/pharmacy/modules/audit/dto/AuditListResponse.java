package com.checkup.pharmacy.modules.audit.dto;

import java.util.List;

public record AuditListResponse(List<AuditLogItemResponse> items, long total) {
}
