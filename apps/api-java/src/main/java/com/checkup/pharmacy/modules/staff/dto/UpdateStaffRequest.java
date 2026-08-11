package com.checkup.pharmacy.modules.staff.dto;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.validation.IndianMobile;
import com.checkup.pharmacy.common.validation.PersonName;

/**
 * PATCH /staff/{id} body. Every field is optional — a partial update; a null
 * field is left unchanged. Email is intentionally absent: it is immutable
 * after account creation.
 */
public record UpdateStaffRequest(
        // Kept in step with CreateStaffRequest — see the note there on why this is the
        // person rule and not the account one.
        @PersonName String name,
        @IndianMobile String phone,
        Role role,
        Boolean isActive
) {
}
