package com.checkup.pharmacy.modules.staff.dto;

import com.checkup.pharmacy.common.enums.Role;
import jakarta.validation.constraints.Pattern;

/**
 * PATCH /staff/{id} body. Every field is optional — a partial update; a null
 * field is left unchanged. Email is intentionally absent: it is immutable
 * after account creation.
 */
public record UpdateStaffRequest(
        String name,
        @Pattern(regexp = "^[6-9]\\d{9}$", message = "Enter a valid 10-digit mobile number") String phone,
        Role role,
        Boolean isActive
) {
}
