package com.checkup.pharmacy.modules.audit;

import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.util.ClientIp;
import com.checkup.pharmacy.common.util.DateRange;
import com.checkup.pharmacy.modules.audit.dto.AuditKpisResponse;
import com.checkup.pharmacy.modules.audit.dto.AuditListResponse;
import com.checkup.pharmacy.modules.audit.dto.AuditLogItemResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.data.domain.Limit;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.time.Instant;
import java.util.List;

/**
 * Writes and reads platform-admin audit events. {@link #log} is a best-effort,
 * fire-and-forget side effect — an audit write must never fail or slow down the
 * business operation it's describing, so every exception is swallowed here.
 */
@Service
public class AuditService {

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);
    private static final int TIMELINE_LIMIT = 100;

    private final AuditLogRepository auditLogRepository;

    public AuditService(AuditLogRepository auditLogRepository) {
        this.auditLogRepository = auditLogRepository;
    }

    /**
     * Joins the caller's transaction (default REQUIRED). Use for success-path
     * events and — critically — any event whose pharmacyId/userId references a
     * row created in the SAME transaction (e.g. a brand-new pharmacy on signup):
     * a separate REQUIRES_NEW transaction can't yet see those uncommitted rows
     * and would fail the audit_logs FK check, taking the whole operation down
     * with it. The trade-off is that if the audited operation rolls back, this
     * audit row rolls back too — acceptable, since there's then nothing to audit.
     */
    @Transactional(propagation = Propagation.REQUIRED)
    public void log(AuditEntry entry) {
        write(entry);
    }

    /**
     * Commits in its OWN transaction (REQUIRES_NEW) so the record survives even
     * when the caller's transaction rolls back — the point of a failed-operation
     * audit (e.g. a failed login). Only safe when every FK target (pharmacy/user)
     * is already committed; never use this for an event referencing an entity
     * created in the caller's still-open transaction (see {@link #log}).
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void logDurable(AuditEntry entry) {
        write(entry);
    }

    private void write(AuditEntry entry) {
        try {
            String ip = null;
            String userAgent = null;
            var attrs = RequestContextHolder.getRequestAttributes();
            if (attrs instanceof ServletRequestAttributes sra) {
                HttpServletRequest request = sra.getRequest();
                ip = ClientIp.from(request);
                userAgent = request.getHeader("User-Agent");
            }
            String requestId = MDC.get("requestId");

            AuditLog entity = AuditLog.create(entry.pharmacyId, entry.userId, entry.userEmail, entry.module,
                    entry.action, entry.entity, entry.entityId, entry.resourceName, entry.oldData, entry.newData,
                    ip, userAgent, entry.severity, entry.status, requestId);
            auditLogRepository.save(entity);
        } catch (Exception e) {
            log.error("Audit log write failed for action {}: {}", entry.action, e.getMessage(), e);
        }
    }

    @Transactional(readOnly = true)
    public AuditListResponse list(String search, String module, String action, String severity, String status,
                                  Instant from, Instant to, int page, int limit) {
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 100);
        var result = auditLogRepository.search(blankToNull(search), blankToNull(module), blankToNull(action),
                blankToNull(severity), blankToNull(status), DateRange.from(from), DateRange.to(to),
                PageRequest.of(safePage - 1, safeLimit, Sort.by("createdAt").descending()));
        List<AuditLogItemResponse> items = result.getContent().stream().map(AuditLogItemResponse::from).toList();
        return new AuditListResponse(items, result.getTotalElements());
    }

    @Transactional(readOnly = true)
    public AuditKpisResponse kpis(String module, String action, Instant from, Instant to) {
        String m = blankToNull(module);
        String a = blankToNull(action);
        Instant f = DateRange.from(from);
        Instant t = DateRange.to(to);
        long total = auditLogRepository.countTotal(m, a, null, null, f, t);
        long failed = auditLogRepository.countFailed(m, f, t);
        long securityAlerts = auditLogRepository.countSecurityAlerts(m, f, t);
        long loginEvents = auditLogRepository.countLoginEvents(m, f, t);
        return new AuditKpisResponse(total, failed, securityAlerts, loginEvents);
    }

    @Transactional(readOnly = true)
    public AuditLogItemResponse getById(String id) {
        return auditLogRepository.findByIdWithRelations(id)
                .map(AuditLogItemResponse::from)
                .orElseThrow(() -> new NotFoundException("Audit log not found"));
    }

    @Transactional(readOnly = true)
    public List<AuditLogItemResponse> timeline(String entity, String entityId) {
        if (blankToNull(entity) == null || blankToNull(entityId) == null) {
            return List.of();
        }
        return auditLogRepository.timeline(entity, entityId, Limit.of(TIMELINE_LIMIT))
                .stream().map(AuditLogItemResponse::from).toList();
    }

    private static final int EXPORT_ROW_LIMIT = 50_000;

    @Transactional(readOnly = true)
    public List<AuditLog> forExport(String module, String action, Instant from, Instant to) {
        return auditLogRepository.findForExport(blankToNull(module), blankToNull(action),
                DateRange.from(from), DateRange.to(to), PageRequest.of(0, EXPORT_ROW_LIMIT));
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s;
    }
}
