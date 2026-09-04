package com.checkup.pharmacy.modules.inventory;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.inventory.dto.AddStockRequest;
import com.checkup.pharmacy.modules.inventory.dto.AddStockResponse;
import com.checkup.pharmacy.modules.inventory.dto.AlertsResponse;
import com.checkup.pharmacy.modules.inventory.dto.BatchRecallListResponse;
import com.checkup.pharmacy.modules.inventory.dto.BatchRecallRequest;
import com.checkup.pharmacy.modules.inventory.dto.BatchRecallResponse;
import com.checkup.pharmacy.modules.inventory.dto.CalibrateStockRequest;
import com.checkup.pharmacy.modules.inventory.dto.CalibrateStockResponse;
import com.checkup.pharmacy.modules.inventory.dto.FrequentItemResponse;
import com.checkup.pharmacy.modules.inventory.dto.InventoryPageResponse;
import com.checkup.pharmacy.modules.inventory.dto.InventoryResponse;
import com.checkup.pharmacy.modules.inventory.dto.LedgerPageResponse;
import com.checkup.pharmacy.modules.inventory.dto.PatchInventoryRequest;
import com.checkup.pharmacy.modules.inventory.dto.ReservationItemResult;
import com.checkup.pharmacy.modules.inventory.dto.ReserveStockRequest;
import com.checkup.pharmacy.modules.inventory.dto.WriteOffExpiredRequest;
import com.checkup.pharmacy.modules.inventory.dto.WriteOffExpiredResponse;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
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

import java.time.Instant;
import java.util.List;

/**
 * Stock batches under /api/v1/inventory — tenant-scoped. Reads are open to any
 * authenticated staff member; adding stock / adjusting quantity / changing batch
 * status require OWNER or MANAGER (enforced in the service since the merged PATCH
 * body determines which operation runs); batch recall is OWNER-only.
 */
@RestController
@RequestMapping("/api/v1/inventory")
public class InventoryController {

    private final InventoryService inventoryService;

    public InventoryController(InventoryService inventoryService) {
        this.inventoryService = inventoryService;
    }

    @PostMapping
    public ResponseEntity<ApiResponse<AddStockResponse>> addStock(@Valid @RequestBody AddStockRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(inventoryService.addStock(req)));
    }

    @GetMapping
    public ApiResponse<InventoryPageResponse> list(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String medicineId,
            @RequestParam(defaultValue = "false") boolean inStock,
            @RequestParam(defaultValue = "false") boolean lowStock,
            @RequestParam(defaultValue = "false") boolean nearExpiry,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "false") boolean hasLoose,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit,
            // Two extra COUNT queries the dashboard's alert badge needs — every other
            // caller (batch pickers, loose-sale setup, the loose-overflow split) fetches
            // this same endpoint purely for its item rows and never reads alertCounts, so
            // defaulting this off for them cuts two unconditional round trips per call.
            @RequestParam(defaultValue = "true") boolean includeAlertCounts) {
        return ApiResponse.ok(inventoryService.list(search, medicineId, inStock, lowStock, nearExpiry, status, hasLoose, page, limit, includeAlertCounts));
    }

    @GetMapping("/{id}")
    public ApiResponse<InventoryResponse> getById(@PathVariable String id) {
        return ApiResponse.ok(inventoryService.getById(id));
    }

    @PatchMapping("/{id}")
    public ApiResponse<InventoryResponse> patch(@PathVariable String id, @Valid @RequestBody PatchInventoryRequest req) {
        return ApiResponse.ok(inventoryService.patch(id, req));
    }

    @GetMapping("/ledger")
    public ApiResponse<LedgerPageResponse> getLedger(
            @RequestParam(required = false) String inventoryId,
            @RequestParam(required = false) String medicineId,
            @RequestParam(required = false) String userId,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String direction,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int limit) {
        return ApiResponse.ok(inventoryService.getLedger(inventoryId, medicineId, userId, type, direction, from, to, page, limit));
    }

    @GetMapping("/alerts")
    public ApiResponse<AlertsResponse> getAlerts(@RequestParam(required = false) String type) {
        return ApiResponse.ok(inventoryService.getAlerts(type));
    }

    @GetMapping("/fefo/{medicineId}")
    public ApiResponse<InventoryResponse> getFefoBatch(@PathVariable String medicineId,
                                                        @RequestParam(defaultValue = "1") int quantity) {
        return ApiResponse.ok(inventoryService.getFefoBatch(medicineId, quantity));
    }

    @PostMapping("/reserve")
    public ApiResponse<List<ReservationItemResult>> reserve(@Valid @RequestBody ReserveStockRequest req) {
        return ApiResponse.ok(inventoryService.reserve(req));
    }

    @DeleteMapping("/reserve/{sessionId}")
    public ResponseEntity<Void> release(@PathVariable String sessionId) {
        inventoryService.release(sessionId);
        return ResponseEntity.noContent().build();
    }

    /** "Smart Stock Levels" — recomputes minimum-stock thresholds from 90-day sales velocity. */
    @PostMapping("/calibrate-stock")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    public ApiResponse<CalibrateStockResponse> calibrateStock(@Valid @RequestBody CalibrateStockRequest req) {
        return ApiResponse.ok(inventoryService.calibrateStock(req.dryRun()));
    }

    /** "Quick Add" — most-frequently-billed medicines over the trailing 30 days. */
    @GetMapping("/frequent")
    public ApiResponse<List<FrequentItemResponse>> frequentItems() {
        return ApiResponse.ok(inventoryService.frequentItems());
    }

    /**
     * Writes expired batches off the books — zero stock, marked EXPIRED, permanently.
     *
     * <p>OWNER only, matching batch recall. This destroys real inventory value and cannot be
     * undone, and it creates a tax obligation at the same moment: section 17(5)(h) blocks input
     * credit on goods that are destroyed, so the response reports the credit to reverse in
     * GSTR-3B Table 4(B)(1).
     */
    @PostMapping("/write-off-expired")
    @PreAuthorize("hasRole('OWNER')")
    public ApiResponse<WriteOffExpiredResponse> writeOffExpired(@Valid @RequestBody WriteOffExpiredRequest req) {
        return ApiResponse.ok(inventoryService.writeOffExpired(req));
    }

    @PostMapping("/batch-recall")
    @PreAuthorize("hasRole('OWNER')")
    public ResponseEntity<ApiResponse<BatchRecallResponse>> batchRecall(@Valid @RequestBody BatchRecallRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(inventoryService.batchRecall(req)));
    }

    @GetMapping("/batch-recall")
    public ApiResponse<BatchRecallListResponse> listRecalledBatches(
            @RequestParam(required = false) String batchNumber,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.ok(inventoryService.listRecalledBatches(batchNumber, page, limit));
    }
}
