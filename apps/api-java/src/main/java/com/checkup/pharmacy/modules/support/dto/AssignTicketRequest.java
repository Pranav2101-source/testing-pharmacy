package com.checkup.pharmacy.modules.support.dto;

/**
 * How a ticket should be assigned.
 *
 * <ul>
 *   <li>{@code strategy} null → assign to {@code agentId}, or unassign when {@code agentId} is null.</li>
 *   <li>{@code strategy = ROUND_ROBIN} → pick the least-loaded active agent ({@code agentId} ignored).</li>
 *   <li>{@code strategy = SELF} → assign to the calling support agent ({@code agentId} ignored).</li>
 * </ul>
 */
public record AssignTicketRequest(String agentId, Strategy strategy) {

    public enum Strategy { ROUND_ROBIN, SELF }
}
