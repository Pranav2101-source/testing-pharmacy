package com.checkup.pharmacy.config;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.security.CookieOriginValidationFilter;
import com.checkup.pharmacy.security.JwtAuthenticationFilter;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.security.web.header.writers.StaticHeadersWriter;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;

/**
 * Central security wiring. Stateless (no server sessions), JWT on every request.
 * Public routes are whitelisted; everything else requires an authenticated
 * principal. Auth failures return the shared {@link ApiResponse} envelope so the
 * frontend always receives a consistent 401/403 shape.
 *
 * The authentication *mechanism* (token parsing, filter, principal) lives in the
 * {@code security} package; this class only wires it into the Spring filter chain.
 */
@Configuration
@EnableMethodSecurity // enables @PreAuthorize("hasRole('OWNER')") style role guards
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;
    private final CookieOriginValidationFilter cookieOriginValidationFilter;
    private final ObjectMapper objectMapper;
    private final String allowedOrigins;

    public SecurityConfig(JwtAuthenticationFilter jwtAuthenticationFilter,
                          CookieOriginValidationFilter cookieOriginValidationFilter,
                          ObjectMapper objectMapper,
                          @Value("${app.cors.allowed-origins}") String allowedOrigins) {
        this.jwtAuthenticationFilter = jwtAuthenticationFilter;
        this.cookieOriginValidationFilter = cookieOriginValidationFilter;
        this.objectMapper = objectMapper;
        this.allowedOrigins = allowedOrigins;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                // Spring's CSRF token machinery is disabled because it is built for
                // server-rendered sessions, not a stateless Bearer-token API. The
                // one genuinely CSRF-exposed surface — the httpOnly refresh cookie,
                // which the browser attaches automatically — is covered instead by
                // CookieOriginValidationFilter, which validates Origin/Referer on
                // state-changing requests that carry that cookie.
                //
                // (An earlier version of this comment asserted such a check existed
                // when it did not. It does now; see that class.)
                .csrf(AbstractHttpConfigurer::disable)
                .cors(Customizer.withDefaults())
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.GET, "/api/v1/health").permitAll()
                        // API schema/docs only — never actual tenant data, so safe to leave public
                        // (and requiring auth just to view the docs would be a chicken-and-egg
                        // problem for anyone trying to learn how auth itself works).
                        .requestMatchers(HttpMethod.GET,
                                "/swagger-ui/**", "/swagger-ui.html", "/v3/api-docs/**").permitAll()
                        // Public auth endpoints. Everything else under /auth (me, logout,
                        // change-password) still requires authentication via the default rule.
                        .requestMatchers(HttpMethod.POST,
                                "/api/v1/auth/login",
                                "/api/v1/auth/register",
                                "/api/v1/auth/refresh",
                                "/api/v1/auth/forgot-password",
                                "/api/v1/auth/reset-password").permitAll()
                        // EventSource cannot send an Authorization header, so this route
                        // authenticates itself via a query-string token (see SupportController#stream)
                        // instead of the standard JwtAuthenticationFilter.
                        .requestMatchers(HttpMethod.GET, "/api/v1/support/stream").permitAll()
                        .anyRequest().authenticated())
                // Both are anchored to UsernamePasswordAuthenticationFilter, which is
                // a filter Spring Security knows the order of. Anchoring one custom
                // filter to another fails at startup with "does not have a registered
                // order" — only framework filters are in that registry.
                //
                // Their relative order does not matter: the origin check reads only
                // the request's cookies and headers, so it is correct wherever it sits
                // in the chain as long as it runs before the controller.
                .addFilterBefore(cookieOriginValidationFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
                // ── Security headers (A6) ────────────────────────────────────
                // Spring Security already sends several by default (X-Frame-Options:
                // DENY, X-Content-Type-Options: nosniff, Cache-Control: no-store,
                // and HSTS over HTTPS) because .headers(...) was never customised.
                // What was genuinely absent is a Content-Security-Policy and a
                // Referrer-Policy; both are added here.
                .headers(headers -> headers
                        // This API serves JSON, where CSP is largely inert — the
                        // policy matters for the one HTML surface it does serve,
                        // Swagger UI, and for refusing to be framed.
                        //
                        // 'unsafe-inline' is present ONLY because Swagger UI injects
                        // inline styles and scripts and will not render without it.
                        // That is an acceptable trade here because this origin never
                        // renders user-supplied HTML, so there is no injection sink
                        // for it to protect. The policy that actually guards against
                        // XSS is the SPA's, set at the CDN where the app is served —
                        // do not treat this one as covering the frontend.
                        .contentSecurityPolicy(csp -> csp.policyDirectives(
                                "default-src 'self'; "
                                + "script-src 'self' 'unsafe-inline'; "
                                + "style-src 'self' 'unsafe-inline'; "
                                + "img-src 'self' data:; "
                                + "font-src 'self' data:; "
                                + "connect-src 'self'; "
                                // Clickjacking defence that supersedes X-Frame-Options
                                // in modern browsers.
                                + "frame-ancestors 'none'; "
                                // Stop an injected <base> rewriting every relative URL.
                                + "base-uri 'none'; "
                                // No form on this origin should ever submit anywhere.
                                + "form-action 'none'; "
                                + "object-src 'none'"))
                        // no-referrer, not the usual same-origin default: request URLs
                        // here can carry identifiers in the path (/invoices/{id}), and
                        // there is no legitimate reason to hand those to any third
                        // party the user navigates to.
                        .referrerPolicy(referrer -> referrer.policy(
                                ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER))
                        // Disclaims access to device APIs the API has no use for, so a
                        // compromised script on this origin cannot silently request them.
                        //
                        // Written via StaticHeadersWriter rather than the typed
                        // permissionsPolicy DSL: that method has been renamed across
                        // Spring Security versions (permissionsPolicy →
                        // permissionsPolicyHeader), so pinning to one spelling makes
                        // a routine dependency bump a compile break. The header value
                        // is what matters and this emits it identically.
                        .addHeaderWriter(new StaticHeadersWriter(
                                "Permissions-Policy",
                                "camera=(), microphone=(), geolocation=(), payment=(), usb=()")))
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint((req, res, e) -> writeError(res, HttpServletResponse.SC_UNAUTHORIZED, "Unauthorized"))
                        .accessDeniedHandler((req, res, e) -> writeError(res, HttpServletResponse.SC_FORBIDDEN, "Forbidden")));

        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        // BCrypt — verifies the existing $2a/$2b hashes and produces the same format.
        return new BCryptPasswordEncoder();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(Arrays.stream(allowedOrigins.split(",")).map(String::trim).toList());
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true); // refresh-token cookie needs credentialed requests

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }

    private void writeError(HttpServletResponse res, int status, String message) throws IOException {
        res.setStatus(status);
        // The servlet spec defaults the writer to ISO-8859-1, not UTF-8 — harmless for today's
        // ASCII-only messages ("Unauthorized"/"Forbidden"), but would silently mangle any
        // non-ASCII character into "?" if either message ever changes.
        res.setCharacterEncoding("UTF-8");
        res.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(res.getWriter(), ApiResponse.fail(message));
    }
}
