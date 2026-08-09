package com.checkup.pharmacy.modules.staff.dto;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.validation.AccountName;
import com.checkup.pharmacy.common.validation.IndianMobile;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * POST /staff body. `role` may not be OWNER here — new staff always start as
 * non-owner; promotion to OWNER happens later via {@link UpdateStaffRequest}.
 */
public record CreateStaffRequest(
        @NotBlank @Size(min = 2) @AccountName String name,
        @NotBlank @Email String email,
        @IndianMobile String phone,
        @NotNull Role role,
        @NotBlank @Size(min = 8, message = "Password must be at least 8 characters") String password
) {
}
