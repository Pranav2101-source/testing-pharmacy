package com.checkup.pharmacy.security;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.auth.RefreshTokenCookie;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.List;
import java.util.Set;

/**
 * CSRF protection for the cookie-authenticated routes.
 *
 * <p>{@code SecurityConfig} disables Spring's CSRF token machinery — correct for a
 * stateless Bearer-token API — and its comment claimed the risk was "handled via
 * Origin checks on cookie routes". <b>No such check existed.</b> This class is
 * that check, actually implemented.
 *
 * <p><b>What the exposure was.</b> Every request except the refresh flow
 * authenticates with an {@code Authorization: Bearer} header, which a cross-site
 * attacker cannot set — those are structurally immune to CSRF. The refresh cookie
 * is different: the browser attaches it automatically, so a page on any origin
 * could POST to {@code /api/v1/auth/refresh} and have it succeed. CORS stops the
 * attacker <i>reading</i> the response, so no token is stolen — but refresh
 * <b>rotates</b> the token, so the victim's existing refresh token is invalidated
 * and they are silently logged out. For a pharmacist mid-sale that is a real
 * denial of service, and it is trivially repeatable.
 *
 * <p><b>Why the check is scoped to cookie-bearing requests rather than applied
 * globally.</b> A blanket Origin requirement would reject every legitimate
 * non-browser caller — scripts, server-to-server integrations, a future mobile
 * client — because those send no {@code Origin} header at all. Since the refresh
 * cookie is already path-scoped to {@code /api/v1/auth}, "requests carrying that
 * cookie" is precisely the CSRF-exploitable surface and nothing more. Bearer-only
 * requests pass straight through.
 *
 * <p><b>Why a missing Origin is rejected here.</b> Browsers send {@code Origin} on
 * every POST, same-origin included (Fetch spec). So on a state-changing request
 * that carries a cookie, an absent {@code Origin} and {@code Referer} does not
 * describe any real browser flow — treating it as suspicious costs nothing and
 * closes the obvious bypass.
 *
 * <p>This complements rather than replaces {@code SameSite} on the cookie itself.
 * SameSite is the stronger control where the browser honours it; this is the
 * server-side backstop for the cases it does not (older browsers, and
 * {@code SameSite=None} deployments).
 */
@Component
public class CookieOriginValidationFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(CookieOriginValidationFilter.class);

    /** Methods that can change state. GET/HEAD/OPTIONS are not CSRF-actionable here. */
    private static final Set<String> STATE_CHANGING = Set.of("POST", "PUT", "PATCH", "DELETE");

    private final List<String> allowedOrigins;
    private final ObjectMapper objectMapper;

    public CookieOriginValidationFilter(@Value("${app.cors.allowed-origins}") String allowedOrigins,
                                        ObjectMapper objectMapper) {
        this.allowedOrigins = Arrays.stream(allowedOrigins.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain chain) throws ServletException, IOException {

        if (!STATE_CHANGING.contains(request.getMethod().toUpperCase()) || !carriesRefreshCookie(request)) {
            chain.doFilter(request, response);
            return;
        }

        String origin = originOf(request);
        if (origin != null && allowedOrigins.contains(origin)) {
            chain.doFilter(request, response);
            return;
        }

        // Log the rejected origin: a spike here is either an attack or a
        // misconfigured ALLOWED_ORIGINS after a deploy, and the two are impossible
        // to tell apart without knowing what was actually sent.
        log.warn("Blocked cookie-authenticated {} {} — Origin '{}' is not in the allowed list {}",
                request.getMethod(), request.getRequestURI(), origin, allowedOrigins);

        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setCharacterEncoding("UTF-8");
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getWriter(),
                ApiResponse.fail("Request origin not allowed"));
    }

    private boolean carriesRefreshCookie(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return false;
        }
        for (Cookie cookie : cookies) {
            if (RefreshTokenCookie.NAME.equals(cookie.getName())) {
                return true;
            }
        }
        return false;
    }

    /**
     * The request's origin, preferring the {@code Origin} header and falling back
     * to the origin portion of {@code Referer}.
     *
     * <p>Returns null when neither is usable — including the literal string
     * {@code "null"}, which browsers send for sandboxed iframes and some
     * cross-origin redirects and which must never be treated as a real origin.
     */
    private String originOf(HttpServletRequest request) {
        String origin = request.getHeader(HttpHeaders.ORIGIN);
        if (origin != null && !origin.isBlank() && !"null".equals(origin)) {
            return origin;
        }

        String referer = request.getHeader(HttpHeaders.REFERER);
        if (referer == null || referer.isBlank()) {
            return null;
        }
        try {
            URI uri = new URI(referer);
            if (uri.getScheme() == null || uri.getHost() == null) {
                return null;
            }
            // Rebuild scheme://host[:port] so it can be compared to the configured
            // origins — a raw Referer carries the full path as well.
            StringBuilder sb = new StringBuilder()
                    .append(uri.getScheme()).append("://").append(uri.getHost());
            if (uri.getPort() != -1) {
                sb.append(':').append(uri.getPort());
            }
            return sb.toString();
        } catch (URISyntaxException e) {
            return null;
        }
    }
}
