package com.checkup.pharmacy.modules.support.dto;

import java.util.List;

/** {@link TicketResponse} plus the message thread and top-level ticket attachments — GET /tickets/:id only. */
public record TicketDetailResponse(
        String id, String ticketNumber, String pharmacyId, String raisedById, String categoryId,
        String customTitle, String assignedAgentId, com.checkup.pharmacy.common.enums.TicketStatus status,
        com.checkup.pharmacy.common.enums.TicketPriority priority, com.checkup.pharmacy.common.enums.TicketSLA sla,
        com.checkup.pharmacy.common.enums.TicketLanguage language, java.time.Instant dueDate, String description,
        String mobile, String altMobile, java.time.Instant resolvedAt, java.time.Instant createdAt,
        java.time.Instant updatedAt, TicketResponse.CategoryRef category, TicketResponse.UserRef raisedBy,
        TicketResponse.AgentRef assignedAgent, TicketResponse.PharmacyRef pharmacy,
        List<AttachmentResponse> attachments, List<MessageResponse> messages
) {
    public static TicketDetailResponse from(TicketResponse t, List<AttachmentResponse> attachments,
                                            List<MessageResponse> messages) {
        return new TicketDetailResponse(t.id(), t.ticketNumber(), t.pharmacyId(), t.raisedById(), t.categoryId(),
                t.customTitle(), t.assignedAgentId(), t.status(), t.priority(), t.sla(), t.language(), t.dueDate(),
                t.description(), t.mobile(), t.altMobile(), t.resolvedAt(), t.createdAt(), t.updatedAt(),
                t.category(), t.raisedBy(), t.assignedAgent(), t.pharmacy(), attachments, messages);
    }
}
