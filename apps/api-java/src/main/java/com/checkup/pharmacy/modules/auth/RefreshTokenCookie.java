package com.checkup.pharmacy.modules.auth;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * Manages the refresh-token cookie. The refresh token lives ONLY in this
 * httpOnly cookie — never in a JS-readable place — so an injected script cannot
 * read it. It is scoped to the auth path so the browser never sends it to any
 * other endpoint (least privilege).
 */
@Component
public class RefreshTokenCookie {

    public static final String NAME = "refresh_token";
    private static final String PATH = "/api/v1/auth";

    private final boolean secure;
    private final String sameSite;
    private final Duration maxAge;

    public RefreshTokenCookie(@Value("${app.cookie.secure}") boolean secure,
                              @Value("${app.cookie.same-site}") String sameSite,
                              @Value("${app.jwt.refresh-ttl}") Duration maxAge) {
        this.secure = secure;
        this.sameSite = sameSite;
        this.maxAge = maxAge;
    }

    public void set(HttpServletResponse response, String token) {
        response.addHeader(HttpHeaders.SET_COOKIE, build(token, maxAge).toString());
    }

    public void clear(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, build("", Duration.ZERO).toString());
    }

    private ResponseCookie build(String value, Duration age) {
        return ResponseCookie.from(NAME, value)
                .httpOnly(true)
                .secure(secure)
                .sameSite(sameSite)
                .path(PATH)
                .maxAge(age)
                .build();
    }
}
