package com.checkup.pharmacy.modules.notification;

import com.checkup.pharmacy.common.domain.CreatedAtEntity;
import com.checkup.pharmacy.common.enums.NotificationStatus;
import com.checkup.pharmacy.common.enums.NotificationType;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * An outbound notification, in-app or otherwise (table "notification_logs"). Today only
 * IN_APP is actually dispatched (SMS/EMAIL/WHATSAPP are deliberately paused — no D4/SMS
 * provider wired yet); the bell just surfaces every row for the pharmacy. See
 * {@link NotificationService#inAppNotify} for how a row gets created.
 */
@Entity
@Table(name = "notification_logs")
public class NotificationLog extends CreatedAtEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "type")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private NotificationType type;

    @Column(name = "recipient")
    private String recipient;

    @Column(name = "subject")
    private String subject;

    @Column(name = "message")
    private String message;

    @Column(name = "status")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private NotificationStatus status = NotificationStatus.PENDING;

    @Column(name = "error")
    private String error;

    @Column(name = "sentAt")
    private Instant sentAt;

    @Column(name = "isRead")
    private boolean isRead = false;

    protected NotificationLog() {
        // Required by JPA.
    }

    public static NotificationLog create(String pharmacyId, NotificationType type, String recipient,
                                         String subject, String message) {
        NotificationLog n = new NotificationLog();
        n.assignId(Cuid.generate());
        n.pharmacyId = pharmacyId;
        n.type = type;
        n.recipient = recipient;
        n.subject = subject;
        n.message = message;
        n.status = NotificationStatus.PENDING;
        return n;
    }

    public void markSent() {
        this.status = NotificationStatus.SENT;
        this.sentAt = Instant.now();
    }

    public void markFailed(String error) {
        this.status = NotificationStatus.FAILED;
        this.error = error == null ? null : error.substring(0, Math.min(error.length(), 500));
    }

    public void markRead() {
        this.isRead = true;
    }

    public String getPharmacyId() { return pharmacyId; }

    public NotificationType getType() { return type; }

    public String getRecipient() { return recipient; }

    public String getSubject() { return subject; }

    public String getMessage() { return message; }

    public NotificationStatus getStatus() { return status; }

    public String getError() { return error; }

    public Instant getSentAt() { return sentAt; }

    public boolean isRead() { return isRead; }
}
