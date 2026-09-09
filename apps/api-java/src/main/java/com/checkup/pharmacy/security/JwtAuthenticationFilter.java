package com.checkup.pharmacy.security;

import com.checkup.pharmacy.modules.user.AuthStatus;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.tenant.SystemContext;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Optional;

/**
 * Authenticates requests from the "Authorization: Bearer <accessToken>" header:
 *   1. verify signature (HS256 secret)
 *   2. reject refresh tokens on protected routes (type must be "access")
 *   3. confirm the user still exists, is active, and the token's tokenVersion
 *      still matches the DB — so a logout/password-change revokes instantly
 *      across every instance.
 *
 * On any failure it simply does not authenticate; SecurityConfig then returns
 * the 401 envelope. It never throws, so public routes still pass through.
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String BEARER_PREFIX = "Bearer ";

    private final JwtService jwtService;
    private final UserRepository userRepository;
    private final AuthStatusCache authStatusCache;

    public JwtAuthenticationFilter(JwtService jwtService, UserRepository userRepository,
                                   AuthStatusCache authStatusCache) {
        this.jwtService = jwtService;
        this.userRepository = userRepository;
        this.authStatusCache = authStatusCache;
    }

    @Override
    protected void doFilterInternal(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull FilterChain chain) throws ServletException, IOException {
        // userId/pharmacyId are cleared in RequestIdFilter, not here — it wraps this
        // filter (and everything else), so its finally block runs last and can still
        // log the per-request access-log line while these MDC values are present.
        authenticate(request);
        chain.doFilter(request, response);
    }

    private void authenticate(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith(BEARER_PREFIX)) {
            return;
        }

        String token = header.substring(BEARER_PREFIX.length());
        try {
            JwtPayload payload = jwtService.verify(token);

            // Refresh tokens must never authenticate a protected route.
            if (!payload.isAccessToken()) {
                return;
            }

            // Runs as system: this lookup happens BEFORE the SecurityContext is
            // populated, so there is no tenant scope yet for RLS to key off. Left
            // unelevated, the row-level policy would fail this closed and every
            // authenticated request in the application would 401. The token's
            // signature is already verified at this point, so we are re-reading a
            // user the caller has proven they are — not widening access.
            //
            // Projection, not the full entity: this is the single most-executed
            // query in the system, and it only needs two fields. Loading the whole
            // User pulled passwordHash and passwordResetToken into memory on every
            // request. See AuthStatus.
            // Short-TTL in-process cache for the revocation read — see AuthStatusCache. Every
            // path that revokes a session also evicts this entry, so a logout/deactivation is
            // effective at once; the TTL only bounds a missed eviction or cross-instance lag.
            Optional<AuthStatus> maybeStatus = authStatusCache.resolve(
                    payload.sub(),
                    () -> SystemContext.callAsSystem(() -> userRepository.findAuthStatusById(payload.sub())));
            if (maybeStatus.isEmpty()) {
                return;
            }
            AuthStatus status = maybeStatus.get();

            // Revocation check: inactive user or stale token version => not authenticated.
            if (!status.active() || status.tokenVersion() != payload.tokenVersion()) {
                return;
            }

            UserPrincipal principal = UserPrincipal.from(payload);
            var authority = new SimpleGrantedAuthority("ROLE_" + payload.role().name());
            var authentication = new UsernamePasswordAuthenticationToken(
                    principal, null, List.of(authority));
            authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
            SecurityContextHolder.getContext().setAuthentication(authentication);
            MDC.put("userId", payload.sub());
            MDC.put("pharmacyId", payload.pharmacyId());
        } catch (JwtException | IllegalArgumentException ex) {
            // Invalid/expired/tampered token — leave the context unauthenticated.
            SecurityContextHolder.clearContext();
        }
    }
}
