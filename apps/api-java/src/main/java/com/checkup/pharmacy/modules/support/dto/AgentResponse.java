package com.checkup.pharmacy.modules.support.dto;

import com.checkup.pharmacy.modules.support.SupportAgent;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;

public record AgentResponse(String id, boolean isActive, Instant lastAssignedAt, Instant createdAt, UserRef user,
                            @JsonProperty("_count") TicketCount count) {

    public record UserRef(String id, String name, String email, boolean isActive, Instant lastLoginAt) {
    }

    public record TicketCount(long tickets) {
    }

    public static AgentResponse from(SupportAgent a, long ticketCount) {
        UserRef user = a.getUser() != null
                ? new UserRef(a.getUser().getId(), a.getUser().getName(), a.getUser().getEmail(),
                        a.getUser().isActive(), a.getUser().getLastLoginAt())
                : null;
        return new AgentResponse(a.getId(), a.isActive(), a.getLastAssignedAt(), a.getCreatedAt(), user,
                new TicketCount(ticketCount));
    }
}
