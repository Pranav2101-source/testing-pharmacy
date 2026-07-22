package com.checkup.pharmacy.common.util;

import jakarta.servlet.http.HttpServletRequest;

/** Resolves the caller's IP for rate limiting — behind Railway's proxy, {@code getRemoteAddr()} is the proxy's own address. */
public final class ClientIp {

    private ClientIp() {
    }

    public static String from(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            // The header is a comma-separated chain; the first entry is the original client.
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
