package com.checkup.pharmacy.modules.support.dto;

/** {@code agentId} nullable/absent = unassign. */
public record AssignTicketRequest(String agentId) {
}
