package com.checkup.pharmacy.modules.support;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface TicketAttachmentRepository extends JpaRepository<TicketAttachment, String> {

    List<TicketAttachment> findByTicketId(String ticketId);

    List<TicketAttachment> findByMessageId(String messageId);

    @Query("SELECT a FROM TicketAttachment a LEFT JOIN FETCH a.ticket WHERE a.fileUrl = :fileUrl")
    Optional<TicketAttachment> findByFileUrl(@Param("fileUrl") String fileUrl);
}
