package com.checkup.pharmacy.modules.support;

import com.checkup.pharmacy.common.domain.CreatedAtEntity;
import com.checkup.pharmacy.common.util.Cuid;
import com.checkup.pharmacy.modules.user.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

/** A message in a support-ticket thread (table "ticket_messages"). */
@Entity
@Table(name = "ticket_messages")
public class TicketMessage extends CreatedAtEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "ticketId")
    private String ticketId;

    @Column(name = "senderId")
    private String senderId;

    @Column(name = "message")
    private String message;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "senderId", insertable = false, updatable = false)
    private User sender;

    protected TicketMessage() {
        // Required by JPA.
    }

    public static TicketMessage create(String pharmacyId, String ticketId, String senderId, String message) {
        TicketMessage m = new TicketMessage();
        m.assignId(Cuid.generate());
        m.pharmacyId = pharmacyId;
        m.ticketId = ticketId;
        m.senderId = senderId;
        m.message = message;
        return m;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getTicketId() { return ticketId; }

    public String getSenderId() { return senderId; }

    public String getMessage() { return message; }

    public User getSender() { return sender; }
}
