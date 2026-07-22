package com.checkup.pharmacy.modules.notification;

import com.checkup.pharmacy.common.enums.NotificationStatus;
import com.checkup.pharmacy.common.enums.NotificationType;
import com.checkup.pharmacy.modules.notification.dto.NotificationLogResponse;
import com.checkup.pharmacy.modules.notification.dto.UnreadCountResponse;
import com.checkup.pharmacy.tenant.CrossTenant;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.transaction.annotation.Propagation;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * In-app notification log, per pharmacy. Only IN_APP is dispatched today — no
 * SMS/email provider is wired up yet, so {@link #inAppNotify} is the sole entry
 * point other modules call to surface a bell notification.
 */
@Service
public class NotificationService {

    private static final int LOGS_LIMIT = 50;
    private static final int FAILED_LIMIT = 20;
    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);

    private final NotificationRepository notificationRepository;

    public NotificationService(NotificationRepository notificationRepository) {
        this.notificationRepository = notificationRepository;
    }

    /**
     * Best-effort — never throws. Callers (calendar, support, purchases, ...)
     * fire this as a side effect of their own transaction and must not have
     * their business operation fail because a notification row couldn't be
     * written.
     *
     * <p><b>REQUIRES_NEW is what makes that promise true.</b> With the default
     * REQUIRED propagation this joined the caller's transaction, so a failed insert
     * marked that transaction rollback-only — the {@code catch} below swallowed the
     * exception, the caller carried on believing it had succeeded, and then the
     * whole business operation failed at commit. A notification could silently kill
     * the ticket, purchase order, or calendar event it was reporting on. Its own
     * transaction means a failure here really is contained.
     *
     * <p><b>Cross-tenant by design.</b> The support flow notifies the platform
     * support team about a ticket raised by a pharmacy, so this writes a row whose
     * pharmacyId differs from the caller's tenant. Row-Level Security correctly
     * rejects that from a tenant-scoped transaction — it was caught doing exactly
     * that during verification. The pharmacyId here is always supplied by internal
     * code (the caller's own tenant, or the platform support pharmacy), never from
     * user input.
     */
    @CrossTenant("Notifies another tenant — the platform support team — about a pharmacy's ticket.")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void inAppNotify(String pharmacyId, String subject, String message) {
        try {
            NotificationLog n = NotificationLog.create(pharmacyId, NotificationType.IN_APP, "in-app", subject, message);
            n.markSent();
            notificationRepository.save(n);
        } catch (Exception e) {
            log.error("inAppNotify failed for pharmacy {}: {}", pharmacyId, e.getMessage(), e);
        }
    }

    @Transactional(readOnly = true)
    public List<NotificationLogResponse> getLogs() {
        return notificationRepository
                .findByPharmacyIdOrderByCreatedAtDesc(TenantContext.pharmacyId(), Limit.of(LOGS_LIMIT))
                .stream().map(NotificationLogResponse::from).toList();
    }

    @Transactional(readOnly = true)
    public UnreadCountResponse getUnreadCount() {
        return new UnreadCountResponse(notificationRepository.countByPharmacyIdAndIsReadFalse(TenantContext.pharmacyId()));
    }

    @Transactional
    public void markAllRead() {
        notificationRepository.markAllRead(TenantContext.pharmacyId());
    }

    @Transactional
    public void markOneRead(String id) {
        notificationRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .ifPresent(n -> {
                    n.markRead();
                    notificationRepository.save(n);
                });
    }

    @Transactional(readOnly = true)
    public List<NotificationLogResponse> getFailed() {
        return notificationRepository
                .findByPharmacyIdAndStatusOrderByCreatedAtDesc(TenantContext.pharmacyId(), NotificationStatus.FAILED, Limit.of(FAILED_LIMIT))
                .stream().map(NotificationLogResponse::from).toList();
    }
}
