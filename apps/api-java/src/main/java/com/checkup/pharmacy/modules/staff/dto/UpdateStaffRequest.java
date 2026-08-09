package com.checkup.pharmacy.modules.staff.dto;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.validation.AccountName;
import com.checkup.pharmacy.common.validation.IndianMobile;

/**
 * PATCH /staff/{id} body. Every field is optional — a partial update; a null
 * field is left unchanged. Email is intentionally absent: it is immutable
 * after account creation.
 */
public record UpdateStaffRequest(
        @AccountName String name,
        @IndianMobile String phone,
        Role role,
        Boolean isActive
) {
}
