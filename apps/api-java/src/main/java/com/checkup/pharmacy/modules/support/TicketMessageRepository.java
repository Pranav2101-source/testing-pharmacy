package com.checkup.pharmacy.modules.support;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface TicketMessageRepository extends JpaRepository<TicketMessage, String> {

    @Query("SELECT m FROM TicketMessage m LEFT JOIN FETCH m.sender WHERE m.ticketId = :ticketId ORDER BY m.createdAt ASC")
    List<TicketMessage> findByTicketIdOrderByCreatedAtAsc(@Param("ticketId") String ticketId);
}
