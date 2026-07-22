package com.checkup.pharmacy.modules.support.dto;

import com.checkup.pharmacy.common.enums.TicketLanguage;
import com.checkup.pharmacy.common.enums.TicketPriority;
import com.checkup.pharmacy.common.enums.TicketSLA;
import com.checkup.pharmacy.common.enums.TicketStatus;
import com.checkup.pharmacy.modules.support.SupportTicket;

import java.time.Instant;

/** Matches the shared `ticketIncludes` shape from the old backend — used for list/create/status/assign responses. */
public record TicketResponse(
        String id, String ticketNumber, String pharmacyId, String raisedById, String categoryId,
        String customTitle, String assignedAgentId, TicketStatus status, TicketPriority priority, TicketSLA sla,
        TicketLanguage language, Instant dueDate, String description, String mobile, String altMobile,
        Instant resolvedAt, Instant createdAt, Instant updatedAt,
        CategoryRef category, UserRef raisedBy, AgentRef assignedAgent, PharmacyRef pharmacy
) {
    public record CategoryRef(String id, String name) {
    }

    public record UserRef(String id, String name, String role, String email, String phone) {
    }

    public record AgentRef(String id, AgentUserRef user) {
    }

    public record AgentUserRef(String id, String name) {
    }

    public record PharmacyRef(String id, String name, String phone, String email, String address, String city,
                              String state, String gstin, String drugLicense) {
    }

    public static TicketResponse from(SupportTicket t) {
        CategoryRef category = t.getCategory() != null
                ? new CategoryRef(t.getCategory().getId(), t.getCategory().getName()) : null;
        UserRef raisedBy = t.getRaisedBy() != null
                ? new UserRef(t.getRaisedBy().getId(), t.getRaisedBy().getName(), t.getRaisedBy().getRole().name(),
                        t.getRaisedBy().getEmail(), t.getRaisedBy().getPhone())
                : null;
        AgentRef assignedAgent = t.getAssignedAgent() != null
                ? new AgentRef(t.getAssignedAgent().getId(), t.getAssignedAgent().getUser() != null
                        ? new AgentUserRef(t.getAssignedAgent().getUser().getId(), t.getAssignedAgent().getUser().getName())
                        : null)
                : null;
        PharmacyRef pharmacy = t.getPharmacy() != null
                ? new PharmacyRef(t.getPharmacy().getId(), t.getPharmacy().getName(), t.getPharmacy().getPhone(),
                        t.getPharmacy().getEmail(), t.getPharmacy().getAddress(), t.getPharmacy().getCity(),
                        t.getPharmacy().getState(), t.getPharmacy().getGstin(), t.getPharmacy().getDrugLicense())
                : null;
        return new TicketResponse(t.getId(), t.getTicketNumber(), t.getPharmacyId(), t.getRaisedById(),
                t.getCategoryId(), t.getCustomTitle(), t.getAssignedAgentId(), t.getStatus(), t.getPriority(),
                t.getSla(), t.getLanguage(), t.getDueDate(), t.getDescription(), t.getMobile(), t.getAltMobile(),
                t.getResolvedAt(), t.getCreatedAt(), t.getUpdatedAt(), category, raisedBy, assignedAgent, pharmacy);
    }
}
