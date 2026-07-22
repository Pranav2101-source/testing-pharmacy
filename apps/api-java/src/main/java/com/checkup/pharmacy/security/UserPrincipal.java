package com.checkup.pharmacy.security;

import com.checkup.pharmacy.common.enums.Role;

/**
 * The authenticated principal stored in the SecurityContext. Carries the tenant
 * (pharmacyId) so every service can scope its queries — the single most
 * important field for preventing cross-tenant data leaks.
 */
public record UserPrincipal(
        String userId,
        String pharmacyId,
        Role role,
        String email
) {
    public static UserPrincipal from(JwtPayload payload) {
        return new UserPrincipal(payload.sub(), payload.pharmacyId(), payload.role(), payload.email());
    }
}
