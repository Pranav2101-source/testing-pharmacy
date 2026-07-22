package com.checkup.pharmacy.modules.customer;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.customer.dto.CustomerPageResponse;
import com.checkup.pharmacy.modules.customer.dto.OutstandingResponse;
import com.checkup.pharmacy.modules.customer.dto.CustomerRequest;
import com.checkup.pharmacy.modules.customer.dto.CustomerResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Customer management under /api/v1/customers — tenant-scoped, open to any authenticated staff member. */
@RestController
@RequestMapping("/api/v1/customers")
public class CustomerController {

    private final CustomerService customerService;

    public CustomerController(CustomerService customerService) {
        this.customerService = customerService;
    }

    @GetMapping
    public ApiResponse<CustomerPageResponse> list(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String customerType,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.ok(customerService.list(search, customerType, page, limit));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<CustomerResponse>> create(@Valid @RequestBody CustomerRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(customerService.create(req)));
    }

    /** Receivables — customers who currently owe money. Literal segment, so it resolves before {@code /{id}}. */
    @GetMapping("/outstanding")
    public ApiResponse<OutstandingResponse> outstanding() {
        return ApiResponse.ok(customerService.listOutstanding());
    }

    @GetMapping("/{id}")
    public ApiResponse<CustomerResponse> getById(@PathVariable String id) {
        return ApiResponse.ok(customerService.getById(id));
    }

    @PatchMapping("/{id}")
    public ApiResponse<CustomerResponse> update(@PathVariable String id, @Valid @RequestBody CustomerRequest req) {
        return ApiResponse.ok(customerService.update(id, req));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable String id) {
        customerService.softDelete(id);
        return ApiResponse.ok(null);
    }
}
