package com.checkup.pharmacy.modules.support;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface SupportAgentRepository extends JpaRepository<SupportAgent, String> {

    Optional<SupportAgent> findByUserId(String userId);

    /** Round-robin pick — the active agent least recently assigned a ticket (never-assigned agents go first). */
    @Query("SELECT a FROM SupportAgent a LEFT JOIN FETCH a.user WHERE a.isActive = true ORDER BY a.lastAssignedAt ASC NULLS FIRST")
    List<SupportAgent> findActiveOrderByLastAssigned(org.springframework.data.domain.Limit limit);

    @Query("SELECT a FROM SupportAgent a LEFT JOIN FETCH a.user ORDER BY a.createdAt ASC")
    List<SupportAgent> findAllWithUser();

    @Query("SELECT a.assignedAgentId AS agentId, COUNT(a) AS cnt FROM SupportTicket a WHERE a.assignedAgentId IN :agentIds GROUP BY a.assignedAgentId")
    List<AgentTicketCountRow> countTicketsByAgentIdIn(java.util.Collection<String> agentIds);

    interface AgentTicketCountRow {
        String getAgentId();
        long getCnt();
    }
}
