package com.checkup.pharmacy.modules.stockaudit.dto;

import java.time.Instant;

/** Dashboard-home summary — surfaces whichever stock-audit session needs the owner/manager's attention. */
public record AuditOverviewResponse(
        Active active,
        NeedsApproval needsApproval,
        LastApproved lastApproved,
        Long daysSinceLastAudit
) {
    public record Active(String id, String sessionNumber, String status, long totalItems, long countedItems) {
    }

    public record NeedsApproval(String id, String sessionNumber) {
    }

    public record LastApproved(String id, String sessionNumber, Instant approvedAt) {
    }
}
