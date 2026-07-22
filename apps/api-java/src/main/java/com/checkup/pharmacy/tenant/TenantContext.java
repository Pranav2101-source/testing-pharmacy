package com.checkup.pharmacy.tenant;

import com.checkup.pharmacy.common.exception.UnauthorizedException;
import com.checkup.pharmacy.security.UserPrincipal;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * Convenience accessor for the current request's tenant + user, derived from the
 * authenticated principal in the SecurityContext. Services call
 * {@link #pharmacyId()} and MUST include it in every query so a tenant can only
 * ever read or write its own data.
 */
public final class TenantContext {

    private TenantContext() {
    }

    public static UserPrincipal currentUser() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof UserPrincipal principal)) {
            throw new UnauthorizedException("Unauthorized");
        }
        return principal;
    }

    public static String pharmacyId() {
        return currentUser().pharmacyId();
    }

    public static String userId() {
        return currentUser().userId();
    }
}
