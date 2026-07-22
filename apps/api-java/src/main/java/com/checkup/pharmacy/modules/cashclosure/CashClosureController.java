package com.checkup.pharmacy.modules.cashclosure;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.cashclosure.dto.CashClosurePageResponse;
import com.checkup.pharmacy.modules.cashclosure.dto.CashClosureResponse;
import com.checkup.pharmacy.modules.cashclosure.dto.CloseCashClosureRequest;
import com.checkup.pharmacy.modules.cashclosure.dto.CreateCashClosureRequest;
import com.checkup.pharmacy.modules.cashclosure.dto.UpdateCashClosureRequest;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

/**
 * Daily cash reconciliation under /api/v1/cash-closures — tenant-scoped. Every
 * write (init/update/close/dispute) requires OWNER or MANAGER, since it locks
 * in the day's money reconciliation; reads are open to any authenticated staff
 * member.
 */
@RestController
@RequestMapping("/api/v1/cash-closures")
public class CashClosureController {

    private final CashClosureService cashClosureService;

    public CashClosureController(CashClosureService cashClosureService) {
        this.cashClosureService = cashClosureService;
    }

    @GetMapping
    public ApiResponse<CashClosurePageResponse> list(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "30") int limit) {
        return ApiResponse.ok(cashClosureService.list(status, from, to, page, limit));
    }

    @GetMapping("/{id}")
    public ApiResponse<CashClosureResponse> getById(@PathVariable String id) {
        return ApiResponse.ok(cashClosureService.getById(id));
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    public ResponseEntity<ApiResponse<CashClosureResponse>> initForDate(@Valid @RequestBody(required = false) CreateCashClosureRequest req) {
        CreateCashClosureRequest body = req == null ? new CreateCashClosureRequest(null, null, null, null) : req;
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(cashClosureService.initForDate(body)));
    }

    @PatchMapping("/{id}")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    public ApiResponse<CashClosureResponse> update(@PathVariable String id, @Valid @RequestBody UpdateCashClosureRequest req) {
        return ApiResponse.ok(cashClosureService.update(id, req));
    }

    @PostMapping("/{id}/close")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    public ApiResponse<CashClosureResponse> close(@PathVariable String id, @Valid @RequestBody CloseCashClosureRequest req) {
        return ApiResponse.ok(cashClosureService.close(id, req));
    }

    @PostMapping("/{id}/dispute")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    public ApiResponse<CashClosureResponse> dispute(@PathVariable String id) {
        return ApiResponse.ok(cashClosureService.dispute(id));
    }
}
