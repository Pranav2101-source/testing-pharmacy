package com.checkup.pharmacy.modules.support;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface SupportAgentRepository extends JpaRepository<SupportAgent, String> {

    /** Resolves the agent record behind a logged-in support user — the "assign to me" lookup. */
    Optional<SupportAgent> findByUserId(String userId);

    /**
     * Every active agent, with a write lock held on each row for the duration of the transaction.
     *
     * <p>Round-robin assignment is a read-modify-write: pick the least-loaded agent, then bump their
     * {@code lastAssignedAt}. Two tickets arriving together would both read the same "least loaded"
     * agent before either commits and both land on them. Locking the candidate set serialises
     * concurrent auto-assignments so the load actually spreads. Agent counts are tiny, so this is
     * effectively free. Inner {@code JOIN FETCH} (an agent always has a user) keeps {@code FOR UPDATE}
     * valid.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT a FROM SupportAgent a JOIN FETCH a.user WHERE a.isActive = true")
    List<SupportAgent> findActiveForUpdate();

    @Query("SELECT a FROM SupportAgent a LEFT JOIN FETCH a.user ORDER BY a.createdAt ASC")
    List<SupportAgent> findAllWithUser();

    @Query("SELECT a.assignedAgentId AS agentId, COUNT(a) AS cnt FROM SupportTicket a WHERE a.assignedAgentId IN :agentIds GROUP BY a.assignedAgentId")
    List<AgentTicketCountRow> countTicketsByAgentIdIn(java.util.Collection<String> agentIds);

    interface AgentTicketCountRow {
        String getAgentId();
        long getCnt();
    }
}
