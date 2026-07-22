package com.checkup.pharmacy.modules.stockaudit;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.stockaudit.dto.ApproveSessionRequest;
import com.checkup.pharmacy.modules.stockaudit.dto.AuditItemResponse;
import com.checkup.pharmacy.modules.stockaudit.dto.AuditOverviewResponse;
import com.checkup.pharmacy.modules.stockaudit.dto.AuditReportResponse;
import com.checkup.pharmacy.modules.stockaudit.dto.BatchUpdateItemsRequest;
import com.checkup.pharmacy.modules.stockaudit.dto.CompleteSessionRequest;
import com.checkup.pharmacy.modules.stockaudit.dto.CreateSessionRequest;
import com.checkup.pharmacy.modules.stockaudit.dto.SessionPageResponse;
import com.checkup.pharmacy.modules.stockaudit.dto.SessionResponse;
import com.checkup.pharmacy.modules.stockaudit.dto.UpdateItemRequest;
import com.checkup.pharmacy.modules.stockaudit.dto.VarianceSummaryResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Physical stock-audit sessions under /api/v1/stock-audit — tenant-scoped. Any
 * authenticated staff member can run the count workflow (create/start/count/
 * complete); reopening a completed session or approving/cancelling it is
 * OWNER-only since approval posts stock adjustments.
 */
@RestController
@RequestMapping("/api/v1/stock-audit")
public class StockAuditController {

    private final StockAuditService stockAuditService;

    public StockAuditController(StockAuditService stockAuditService) {
        this.stockAuditService = stockAuditService;
    }

    @PostMapping
    public ResponseEntity<ApiResponse<SessionResponse>> createSession(@Valid @RequestBody(required = false) CreateSessionRequest req) {
        CreateSessionRequest body = req == null ? new CreateSessionRequest(null) : req;
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(stockAuditService.createSession(body)));
    }

    @GetMapping
    public ApiResponse<SessionPageResponse> listSessions(
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.ok(stockAuditService.listSessions(status, page, limit));
    }

    @GetMapping("/{id}")
    public ApiResponse<SessionResponse> getSession(@PathVariable String id) {
        return ApiResponse.ok(stockAuditService.getSession(id));
    }

    /** Dashboard-home summary card — which session needs attention right now. */
    @GetMapping("/overview")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    public ApiResponse<AuditOverviewResponse> getOverview() {
        return ApiResponse.ok(stockAuditService.getOverview());
    }

    /** Historical gain/loss (P&L) report across every approved session. */
    @GetMapping("/report")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    public ApiResponse<AuditReportResponse> getReport() {
        return ApiResponse.ok(stockAuditService.getReport());
    }

    @PatchMapping("/{id}/start")
    public ApiResponse<SessionResponse> startSession(@PathVariable String id) {
        return ApiResponse.ok(stockAuditService.startSession(id));
    }

    @PatchMapping("/{id}/items/{itemId}")
    public ApiResponse<AuditItemResponse> updateItem(@PathVariable String id, @PathVariable String itemId,
                                                      @Valid @RequestBody UpdateItemRequest req) {
        return ApiResponse.ok(stockAuditService.updateItem(id, itemId, req));
    }

    @PatchMapping("/{id}/items")
    public ApiResponse<List<AuditItemResponse>> batchUpdateItems(@PathVariable String id,
                                                                  @Valid @RequestBody BatchUpdateItemsRequest req) {
        return ApiResponse.ok(stockAuditService.batchUpdateItems(id, req));
    }

    @GetMapping("/{id}/variance-summary")
    public ApiResponse<VarianceSummaryResponse> getVarianceSummary(@PathVariable String id) {
        return ApiResponse.ok(stockAuditService.getVarianceSummary(id));
    }

    @PatchMapping("/{id}/reopen")
    @PreAuthorize("hasRole('OWNER')")
    public ApiResponse<SessionResponse> reopenSession(@PathVariable String id) {
        return ApiResponse.ok(stockAuditService.reopenSession(id));
    }

    @PostMapping("/{id}/complete")
    public ApiResponse<SessionResponse> completeSession(@PathVariable String id,
                                                         @Valid @RequestBody(required = false) CompleteSessionRequest req) {
        CompleteSessionRequest body = req == null ? new CompleteSessionRequest(null) : req;
        return ApiResponse.ok(stockAuditService.completeSession(id, body));
    }

    @PostMapping("/{id}/approve")
    @PreAuthorize("hasRole('OWNER')")
    public ApiResponse<SessionResponse> approveSession(@PathVariable String id,
                                                        @Valid @RequestBody(required = false) ApproveSessionRequest req) {
        ApproveSessionRequest body = req == null ? new ApproveSessionRequest(null) : req;
        return ApiResponse.ok(stockAuditService.approveSession(id, body));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('OWNER')")
    public ResponseEntity<Void> cancelSession(@PathVariable String id) {
        stockAuditService.cancelSession(id);
        return ResponseEntity.noContent().build();
    }
}
