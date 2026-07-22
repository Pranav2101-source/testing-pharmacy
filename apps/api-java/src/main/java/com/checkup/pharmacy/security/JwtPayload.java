package com.checkup.pharmacy.security;

import com.checkup.pharmacy.common.enums.Role;

/**
 * The exact claim set the tokens carry:
 *   { sub, pharmacyId, role, email, tokenVersion, type }
 */
public record JwtPayload(
        String sub,
        String pharmacyId,
        Role role,
        String email,
        int tokenVersion,
        String type // "access" | "refresh" | "sse"
) {
    public boolean isAccessToken() {
        return "access".equals(type);
    }

    /**
     * True for the short-lived ticket that authorises opening the support event
     * stream, and nothing else.
     *
     * <p>The type check is the whole security property. The ticket travels in a
     * URL query string — because {@code EventSource} cannot send headers — so it
     * must be assumed to leak into proxy logs, browser history, and referrers. By
     * refusing to authenticate any normal route, a leaked ticket grants a
     * read-only event stream for its brief lifetime instead of full API access.
     */
    public boolean isStreamTicket() {
        return "sse".equals(type);
    }
}
