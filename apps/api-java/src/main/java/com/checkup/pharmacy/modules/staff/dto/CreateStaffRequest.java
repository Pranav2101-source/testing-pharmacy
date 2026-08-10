package com.checkup.pharmacy.modules.staff.dto;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.validation.IndianMobile;
import com.checkup.pharmacy.common.validation.PersonName;
import com.checkup.pharmacy.common.validation.ValidEmail;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * POST /staff body. `role` may not be OWNER here — new staff always start as
 * non-owner; promotion to OWNER happens later via {@link UpdateStaffRequest}.
 */
public record CreateStaffRequest(
        // @PersonName, not the wider @AccountName this used to carry: a staff account
        // belongs to a named person, and QA reported "Anjali2" being accepted. The
        // "Billing Counter 2" style of shared-till login that motivated the wider rule
        // is not something the product offers, so the digits it allowed only ever let
        // typos through.
        @NotBlank @Size(min = 2) @PersonName String name,
        // @ValidEmail, not Jakarta's @Email: the latter accepts "asha@gmail" with no
        // TLD, so a staff account could be created against an address that can never
        // receive its password reset.
        @NotBlank @ValidEmail String email,
        @IndianMobile String phone,
        @NotNull Role role,
        @NotBlank @Size(min = 8, message = "Password must be at least 8 characters") String password
) {
}
