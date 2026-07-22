package com.checkup.pharmacy.modules.audit;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.audit.dto.AuditKpisResponse;
import com.checkup.pharmacy.modules.audit.dto.AuditListResponse;
import com.checkup.pharmacy.modules.audit.dto.AuditLogItemResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.List;

/** Platform-wide audit trail — platform-admin only. */
@RestController
@RequestMapping("/api/v1/platform/audit")
public class AuditController {

    private final AuditService auditService;

    public AuditController(AuditService auditService) {
        this.auditService = auditService;
    }

    @GetMapping
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    public ApiResponse<AuditListResponse> list(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String module,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) String severity,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Instant from,
            @RequestParam(required = false) Instant to,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int limit) {
        return ApiResponse.ok(auditService.list(search, module, action, severity, status, from, to, page, limit));
    }

    @GetMapping("/kpis")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    public ApiResponse<AuditKpisResponse> kpis(
            @RequestParam(required = false) String module,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) Instant from,
            @RequestParam(required = false) Instant to) {
        return ApiResponse.ok(auditService.kpis(module, action, from, to));
    }

    @GetMapping("/timeline")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    public ApiResponse<List<AuditLogItemResponse>> timeline(
            @RequestParam(required = false) String entity,
            @RequestParam(required = false) String entityId) {
        return ApiResponse.ok(auditService.timeline(entity, entityId));
    }

    @GetMapping("/export")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    public ResponseEntity<byte[]> export(
            @RequestParam(required = false) String module,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) Instant from,
            @RequestParam(required = false) Instant to) {
        List<AuditLog> rows = auditService.forExport(module, action, from, to);
        String csv = buildCsv(rows);
        String filename = "platform-audit-" + DateTimeFormatter.ISO_LOCAL_DATE.format(
                Instant.now().atZone(java.time.ZoneOffset.UTC)) + ".csv";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(MediaType.parseMediaType("text/csv"))
                .body(csv.getBytes(StandardCharsets.UTF_8));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    public ApiResponse<AuditLogItemResponse> getById(@PathVariable String id) {
        return ApiResponse.ok(auditService.getById(id));
    }

    private static String buildCsv(List<AuditLog> rows) {
        StringBuilder sb = new StringBuilder();
        sb.append("ID,Date,Tenant,User,Module,Action,Target,Severity,Status,IP Address\r\n");
        for (AuditLog a : rows) {
            sb.append(csv(a.getId())).append(',')
                    .append(csv(a.getCreatedAt() == null ? "" : a.getCreatedAt().toString())).append(',')
                    .append(csv(a.getPharmacy() != null ? a.getPharmacy().getName() : "Platform")).append(',')
                    .append(csv(a.getUserEmail() != null ? a.getUserEmail()
                            : a.getUser() != null ? a.getUser().getEmail() : "System")).append(',')
                    .append(csv(a.getModule().name())).append(',')
                    .append(csv(a.getAction())).append(',')
                    .append(csv(a.getResourceName() != null ? a.getResourceName()
                            : a.getEntityId() != null ? a.getEntityId() : "")).append(',')
                    .append(csv(a.getSeverity().name())).append(',')
                    .append(csv(a.getStatus().name())).append(',')
                    .append(csv(a.getIpAddress() != null ? a.getIpAddress() : "")).append("\r\n");
        }
        return sb.toString();
    }

    private static String csv(String value) {
        return com.checkup.pharmacy.common.util.CsvField.escape(value);
    }
}
