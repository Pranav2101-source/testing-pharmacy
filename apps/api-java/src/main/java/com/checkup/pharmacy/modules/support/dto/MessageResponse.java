package com.checkup.pharmacy.modules.support.dto;

import com.checkup.pharmacy.modules.support.TicketMessage;

import java.time.Instant;
import java.util.List;

public record MessageResponse(String id, String message, Instant createdAt, SenderRef sender,
                              List<AttachmentResponse> attachments) {

    public record SenderRef(String id, String name, String role) {
    }

    public static MessageResponse from(TicketMessage m, List<AttachmentResponse> attachments) {
        SenderRef sender = m.getSender() != null
                ? new SenderRef(m.getSender().getId(), m.getSender().getName(), m.getSender().getRole().name())
                : null;
        return new MessageResponse(m.getId(), m.getMessage(), m.getCreatedAt(), sender, attachments);
    }
}
