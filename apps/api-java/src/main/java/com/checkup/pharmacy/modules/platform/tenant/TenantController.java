package com.checkup.pharmacy.modules.platform.tenant;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.platform.tenant.dto.BulkActionResult;
import com.checkup.pharmacy.modules.platform.tenant.dto.BulkTenantActionRequest;
import com.checkup.pharmacy.modules.platform.tenant.dto.CreateTenantRequest;
import com.checkup.pharmacy.modules.platform.tenant.dto.CreateTenantResponse;
import com.checkup.pharmacy.modules.platform.tenant.dto.EmrSecretRotationResponse;
import com.checkup.pharmacy.modules.platform.tenant.dto.ImportResult;
import com.checkup.pharmacy.modules.platform.tenant.dto.ImportTenantsRequest;
import com.checkup.pharmacy.modules.platform.tenant.dto.TenantActivityItem;
import com.checkup.pharmacy.modules.platform.tenant.dto.TenantDetailResponse;
import com.checkup.pharmacy.modules.platform.tenant.dto.TenantListEnvelope;
import com.checkup.pharmacy.security.UserPrincipal;
import com.checkup.pharmacy.tenant.TenantContext;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/** Platform tenant management endpoints. Platform-admin only. */
@RestController
@RequestMapping("/api/v1/platform/tenants")
@PreAuthorize("hasRole('PLATFORM_ADMIN')")
public class TenantController {

    private final TenantService tenantService;

    public TenantController(TenantService tenantService) {
        this.tenantService = tenantService;
    }

    @GetMapping
    public TenantListEnvelope list(
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "ALL") String status,
            @RequestParam(required = false) String plan,
            @RequestParam(required = false) String state,
            @RequestParam(required = false) String city,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(defaultValue = "createdAt") String sortBy,
            @RequestParam(defaultValue = "true") boolean sortDesc) {
        return tenantService.listTenants(search, status, plan, state, city, page, limit, sortBy, sortDesc);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<CreateTenantResponse> create(@Valid @RequestBody CreateTenantRequest req) {
        UserPrincipal actor = TenantContext.currentUser();
        return ApiResponse.ok(tenantService.createTenant(req, actor.userId(), actor.email()));
    }

    @PostMapping("/import")
    public ApiResponse<ImportResult> importTenants(@Valid @RequestBody ImportTenantsRequest req) {
        UserPrincipal actor = TenantContext.currentUser();
        return ApiResponse.ok(tenantService.importTenants(req.rows(), actor.userId(), actor.pharmacyId()));
    }

    @GetMapping("/export")
    public ResponseEntity<byte[]> export(
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "ALL") String status,
            @RequestParam(required = false) String plan,
            @RequestParam(required = false) String state,
            @RequestParam(required = false) String ids) {
        String csv = tenantService.exportCsv(search, status, plan, state, ids);
        String filename = "tenants-export-" + LocalDate.now() + ".csv";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(MediaType.parseMediaType("text/csv"))
                .body(csv.getBytes(StandardCharsets.UTF_8));
    }

    @PostMapping("/bulk")
    public ApiResponse<BulkActionResult> bulk(@Valid @RequestBody BulkTenantActionRequest req) {
        UserPrincipal actor = TenantContext.currentUser();
        return ApiResponse.ok(tenantService.bulkAction(req.ids(), req.action(), actor.userId()));
    }

    @GetMapping("/{id}")
    public ApiResponse<TenantDetailResponse> get(@PathVariable String id) {
        return ApiResponse.ok(tenantService.getTenant(id));
    }

    @PatchMapping("/{id}/status")
    public ApiResponse<TenantDetailResponse> updateStatus(@PathVariable String id,
                                                          @Valid @RequestBody com.checkup.pharmacy.modules.platform.tenant.dto.UpdateTenantStatusRequest req) {
        UserPrincipal actor = TenantContext.currentUser();
        return ApiResponse.ok(tenantService.updateTenantStatus(id, req.status(), actor.userId()));
    }

    /** Generates a fresh EMR HMAC secret for this tenant; the plaintext is returned once. */
    @PostMapping("/{id}/emr-secret/rotate")
    public ApiResponse<EmrSecretRotationResponse> rotateEmrSecret(@PathVariable String id) {
        UserPrincipal actor = TenantContext.currentUser();
        return ApiResponse.ok(tenantService.rotateEmrSecret(id, actor.userId()));
    }

    @GetMapping("/{id}/activity")
    public ApiResponse<List<TenantActivityItem>> activity(@PathVariable String id) {
        return ApiResponse.ok(tenantService.getTenantActivity(id));
    }

    /**
     * Static global health snapshot — the Node original returned the same fixed
     * payload here (per-tenant health isn't actually measured). Kept for contract
     * parity with the drawer's health tab.
     */
    @GetMapping("/{id}/health")
    public ApiResponse<Map<String, Object>> health(@PathVariable String id) {
        Map<String, Object> data = Map.of(
                "database", Map.of("status", "HEALTHY", "value", "12ms", "detail", "PostgreSQL active"),
                "redis", Map.of("status", "HEALTHY", "value", "24", "detail", "Connections active"),
                "queue", Map.of("status", "HEALTHY", "value", "0", "detail", "Jobs waiting"),
                "storage", Map.of("status", "HEALTHY", "value", "--", "detail", "Not Configured"),
                "api", Map.of("status", "HEALTHY", "value", "124 req/m", "detail", "Normal traffic"),
                "email", Map.of("status", "HEALTHY", "value", "--", "detail", "Not Configured"),
                "backups", Map.of("status", "HEALTHY", "value", "--", "detail", "Not Configured"));
        return ApiResponse.ok(data);
    }

    @GetMapping("/{id}/storage")
    public ApiResponse<Map<String, Object>> storage(@PathVariable String id) {
        Map<String, Object> data = new java.util.HashMap<>();
        for (String k : List.of("used", "limit", "documents", "images", "prescriptions", "invoices")) {
            data.put(k, null);
        }
        return ApiResponse.ok(data);
    }
}
