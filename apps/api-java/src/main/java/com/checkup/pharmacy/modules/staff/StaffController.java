package com.checkup.pharmacy.modules.staff;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.staff.dto.CreateStaffRequest;
import com.checkup.pharmacy.modules.staff.dto.StaffMemberResponse;
import com.checkup.pharmacy.modules.staff.dto.UpdateStaffRequest;
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
 * Staff management under /api/v1/staff — every endpoint is OWNER-only. Managers
 * and below can view their own profile via /auth/me, but team administration is
 * an ownership-level action.
 */
@RestController
@RequestMapping("/api/v1/staff")
@PreAuthorize("hasRole('OWNER')")
public class StaffController {

    private final StaffService staffService;

    public StaffController(StaffService staffService) {
        this.staffService = staffService;
    }

    @GetMapping
    public ApiResponse<List<StaffMemberResponse>> list() {
        return ApiResponse.ok(staffService.list());
    }

    @PostMapping
    public ResponseEntity<ApiResponse<StaffMemberResponse>> create(@Valid @RequestBody CreateStaffRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(staffService.create(req)));
    }

    @PatchMapping("/{id}")
    public ApiResponse<StaffMemberResponse> update(
            @PathVariable String id, @Valid @RequestBody UpdateStaffRequest req) {
        return ApiResponse.ok(staffService.update(id, req));
    }

    /** Soft-delete: deactivates the account. Staff records are never hard-deleted. */
    @DeleteMapping("/{id}")
    public ApiResponse<Void> deactivate(@PathVariable String id) {
        staffService.deactivate(id);
        return ApiResponse.ok(null);
    }
}
