package com.checkup.pharmacy.modules.auth.dto;

import com.checkup.pharmacy.common.validation.PersonName;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * PATCH /auth/me body — the signed-in user renaming themselves.
 *
 * <p>@PersonName matches RegisterRequest.ownerName, which has always carried it: the
 * name was validated when the account was created and then not when it was edited, so
 * "Pranav 2" could be saved through this endpoint onto a row the register form would
 * have rejected.
 */
public record UpdateProfileRequest(
        @NotBlank(message = "Name is required") @Size(min = 2) @PersonName String name
) {
}
