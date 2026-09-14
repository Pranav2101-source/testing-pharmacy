package com.checkup.pharmacy.modules.customerledger;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.customerledger.dto.AdvanceReceiptResponse;
import com.checkup.pharmacy.modules.customerledger.dto.CustomerBalancesResponse;
import com.checkup.pharmacy.modules.customerledger.dto.CustomerStatementResponse;
import com.checkup.pharmacy.modules.customerledger.dto.RecordAdvanceRequest;
import com.checkup.pharmacy.modules.customerledger.dto.RefundAdvanceRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * A customer's money: deposits, refunds and the khata itself, under
 * /api/v1/customers/{customerId}. Tenant-scoped.
 *
 * <p>Taking a deposit is open to any authenticated staff member — it is an ordinary
 * counter transaction, and refusing it would just push cashiers into recording the
 * money somewhere the ledger cannot see. Handing an advance BACK is OWNER-only: it
 * moves money out of the till against no sale, which is the shape of every till
 * fraud, and it is rare enough that needing the owner costs nothing.
 */
@RestController
@RequestMapping("/api/v1/customers/{customerId}")
public class CustomerLedgerController {

    private final CustomerAccountService accountService;

    public CustomerLedgerController(CustomerAccountService accountService) {
        this.accountService = accountService;
    }

    @PostMapping("/advances")
    public ResponseEntity<ApiResponse<AdvanceReceiptResponse>> recordAdvance(
            @PathVariable String customerId, @Valid @RequestBody RecordAdvanceRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(accountService.recordAdvance(customerId, req)));
    }

    @PostMapping("/refunds")
    @PreAuthorize("hasRole('OWNER')")
    public ResponseEntity<ApiResponse<AdvanceReceiptResponse>> refundAdvance(
            @PathVariable String customerId, @Valid @RequestBody RefundAdvanceRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(accountService.refundAdvance(customerId, req)));
    }

    @GetMapping("/ledger")
    public ApiResponse<CustomerStatementResponse> statement(
            @PathVariable String customerId,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.ok(accountService.statement(customerId, page, limit));
    }

    @GetMapping("/balances")
    public ApiResponse<CustomerBalancesResponse> balances(@PathVariable String customerId) {
        return ApiResponse.ok(accountService.balances(customerId));
    }
}
