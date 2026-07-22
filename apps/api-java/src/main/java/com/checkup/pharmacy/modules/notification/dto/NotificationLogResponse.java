package com.checkup.pharmacy.modules.notification.dto;

import com.checkup.pharmacy.common.enums.NotificationStatus;
import com.checkup.pharmacy.common.enums.NotificationType;
import com.checkup.pharmacy.modules.notification.NotificationLog;

import java.time.Instant;

/** Matches the frontend's NotifLog shape (NotificationBell.tsx). */
public record NotificationLogResponse(
        String id,
        NotificationType type,
        String recipient,
        String subject,
        String message,
        NotificationStatus status,
        boolean isRead,
        String error,
        Instant sentAt,
        Instant createdAt
) {
    public static NotificationLogResponse from(NotificationLog n) {
        return new NotificationLogResponse(n.getId(), n.getType(), n.getRecipient(), n.getSubject(),
                n.getMessage(), n.getStatus(), n.isRead(), n.getError(), n.getSentAt(), n.getCreatedAt());
    }
}
