package com.checkup.pharmacy.modules.migration;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.migration.csv.ColumnMapper;
import com.checkup.pharmacy.modules.migration.dto.ColumnMappingsRequest;
import com.checkup.pharmacy.modules.migration.dto.CommitResult;
import com.checkup.pharmacy.modules.migration.dto.CreateSessionRequest;
import com.checkup.pharmacy.modules.migration.dto.CsvBodyRequest;
import com.checkup.pharmacy.modules.migration.dto.DetectColumnsRequest;
import com.checkup.pharmacy.modules.migration.dto.HistoryItemResponse;
import com.checkup.pharmacy.modules.migration.dto.MedicineMappingResponse;
import com.checkup.pharmacy.modules.migration.dto.MedicineMappingsRequest;
import com.checkup.pharmacy.modules.migration.dto.MedicineSuggestionResponse;
import com.checkup.pharmacy.modules.migration.dto.PreviewResult;
import com.checkup.pharmacy.modules.migration.dto.SessionResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * CSV-import onboarding wizard under /api/v1/migration — owner-only, since it
 * touches the shared medicine catalog plus every entity table in the pharmacy.
 */
@RestController
@RequestMapping("/api/v1/migration")
@PreAuthorize("hasRole('OWNER')")
public class MigrationController {

    private final MigrationService migrationService;

    public MigrationController(MigrationService migrationService) {
        this.migrationService = migrationService;
    }

    @PostMapping("/sessions")
    public ResponseEntity<ApiResponse<SessionResponse>> createSession(@Valid @RequestBody CreateSessionRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(migrationService.createSession(req)));
    }

    @GetMapping("/sessions")
    public ApiResponse<List<SessionResponse>> listSessions() {
        return ApiResponse.ok(migrationService.listSessions());
    }

    @GetMapping("/history")
    public ApiResponse<List<HistoryItemResponse>> history() {
        return ApiResponse.ok(migrationService.history());
    }

    @GetMapping("/sessions/{id}")
    public ApiResponse<SessionResponse> getSession(@PathVariable String id) {
        return ApiResponse.ok(migrationService.getSession(id));
    }

    @PostMapping("/sessions/{id}/complete")
    public ApiResponse<SessionResponse> completeSession(@PathVariable String id) {
        return ApiResponse.ok(migrationService.completeSession(id));
    }

    @DeleteMapping("/sessions/{id}")
    public ApiResponse<SessionResponse> rollbackSession(@PathVariable String id) {
        return ApiResponse.ok(migrationService.rollbackSession(id));
    }

    @PostMapping("/detect-columns")
    public ApiResponse<List<ColumnMapper.ColumnDetection>> detectColumns(@Valid @RequestBody DetectColumnsRequest req) {
        return ApiResponse.ok(migrationService.detectColumns(req.headers()));
    }

    @PatchMapping("/sessions/{id}/column-mappings")
    public ApiResponse<SessionResponse> saveColumnMappings(@PathVariable String id,
                                                           @Valid @RequestBody ColumnMappingsRequest req) {
        return ApiResponse.ok(migrationService.saveColumnMappings(id, req.mappings()));
    }

    @PostMapping("/sessions/{id}/medicine-suggestions")
    public ApiResponse<List<MedicineSuggestionResponse>> medicineSuggestions(@PathVariable String id,
                                                                             @Valid @RequestBody CsvBodyRequest req) {
        return ApiResponse.ok(migrationService.medicineSuggestions(id, req.csvText(), req.columnMappings()));
    }

    @PostMapping("/sessions/{id}/medicine-mappings")
    public ApiResponse<List<MedicineMappingResponse>> medicineMappings(@PathVariable String id,
                                                                       @Valid @RequestBody MedicineMappingsRequest req) {
        return ApiResponse.ok(migrationService.confirmMedicineMappings(id, req));
    }

    @PostMapping("/sessions/{id}/preview/inventory")
    public ApiResponse<PreviewResult> previewInventory(@PathVariable String id, @Valid @RequestBody CsvBodyRequest req) {
        return ApiResponse.ok(migrationService.previewInventory(id, req.csvText(), req.columnMappings()));
    }

    @PostMapping("/sessions/{id}/commit/inventory")
    public ApiResponse<CommitResult> commitInventory(@PathVariable String id, @Valid @RequestBody CsvBodyRequest req) {
        return ApiResponse.ok(migrationService.commitInventory(id, req.csvText(), req.columnMappings()));
    }

    @PostMapping("/sessions/{id}/commit/suppliers")
    public ApiResponse<CommitResult> commitSuppliers(@PathVariable String id, @Valid @RequestBody CsvBodyRequest req) {
        return ApiResponse.ok(migrationService.commitSuppliers(id, req.csvText(), req.columnMappings()));
    }

    @PostMapping("/sessions/{id}/commit/customers")
    public ApiResponse<CommitResult> commitCustomers(@PathVariable String id, @Valid @RequestBody CsvBodyRequest req) {
        return ApiResponse.ok(migrationService.commitCustomers(id, req.csvText(), req.columnMappings()));
    }

    @PostMapping("/sessions/{id}/commit/doctors")
    public ApiResponse<CommitResult> commitDoctors(@PathVariable String id, @Valid @RequestBody CsvBodyRequest req) {
        return ApiResponse.ok(migrationService.commitDoctors(id, req.csvText(), req.columnMappings()));
    }
}
