package com.checkup.pharmacy.modules.auth.dto;

/**
 * The user object returned by login/register — matches the frontend's StoredUser
 * ({ id, name, email, role, pharmacyId, pharmacyName }).
 */
public record AuthUser(
        String id,
        String name,
        String email,
        String role,
        String pharmacyId,
        String pharmacyName
) {
}
