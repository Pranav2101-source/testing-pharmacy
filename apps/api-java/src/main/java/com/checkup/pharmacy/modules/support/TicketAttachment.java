package com.checkup.pharmacy.modules.support;

import com.checkup.pharmacy.common.domain.CreatedAtEntity;
import com.checkup.pharmacy.common.enums.AttachmentFileType;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** An uploaded file attached to a ticket or a specific message (table "ticket_attachments"). */
@Entity
@Table(name = "ticket_attachments")
public class TicketAttachment extends CreatedAtEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "ticketId")
    private String ticketId;

    @Column(name = "messageId")
    private String messageId;

    @Column(name = "fileName")
    private String fileName;

    @Column(name = "fileUrl")
    private String fileUrl;

    @Column(name = "fileSize")
    private int fileSize;

    @Column(name = "mimeType")
    private String mimeType;

    @Column(name = "fileType")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private AttachmentFileType fileType;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "ticketId", insertable = false, updatable = false)
    private SupportTicket ticket;

    protected TicketAttachment() {
        // Required by JPA.
    }

    public static TicketAttachment create(String pharmacyId, String ticketId, String messageId, String fileName,
                                          String fileUrl, int fileSize, String mimeType, AttachmentFileType fileType) {
        TicketAttachment a = new TicketAttachment();
        a.assignId(Cuid.generate());
        a.pharmacyId = pharmacyId;
        a.ticketId = ticketId;
        a.messageId = messageId;
        a.fileName = fileName;
        a.fileUrl = fileUrl;
        a.fileSize = fileSize;
        a.mimeType = mimeType;
        a.fileType = fileType;
        return a;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getTicketId() { return ticketId; }

    public String getMessageId() { return messageId; }

    public String getFileName() { return fileName; }

    public String getFileUrl() { return fileUrl; }

    public int getFileSize() { return fileSize; }

    public String getMimeType() { return mimeType; }

    public AttachmentFileType getFileType() { return fileType; }

    public SupportTicket getTicket() { return ticket; }
}
