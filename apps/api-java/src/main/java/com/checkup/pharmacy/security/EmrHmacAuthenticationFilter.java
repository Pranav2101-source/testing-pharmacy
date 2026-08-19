package com.checkup.pharmacy.security;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.platform.domain.TenantSettingsRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.time.Clock;
import java.util.List;
import java.util.Optional;

/**
 * Authenticates the narrow server-to-server EMR surface without reusing staff
 * JWTs. Each pharmacy verifies against its own secret (see
 * {@link EmrSecretCipher}), never a process-wide one — otherwise any tenant
 * that knew the secret could impersonate any other pharmacy just by changing
 * the {@code X-Pharmacy-Id} header.
 */
@Component
public class EmrHmacAuthenticationFilter extends OncePerRequestFilter {

    public static final String PHARMACY_HEADER = "X-Pharmacy-Id";
    public static final String TIMESTAMP_HEADER = "X-Checkup-Timestamp";
    public static final String SIGNATURE_HEADER = "X-Checkup-Signature";
    private static final String ROUTE_PREFIX = "/api/v1/integrations/emr";
    private static final long MAX_CLOCK_SKEW_SECONDS = 300;
    private static final int MAX_SIGNED_BODY_BYTES = 1_048_576;

    private final PharmacyRepository pharmacyRepository;
    private final TenantSettingsRepository tenantSettingsRepository;
    private final EmrSecretCipher secretCipher;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    @Autowired
    public EmrHmacAuthenticationFilter(PharmacyRepository pharmacyRepository,
                                       TenantSettingsRepository tenantSettingsRepository,
                                       EmrSecretCipher secretCipher,
                                       ObjectMapper objectMapper) {
        this(pharmacyRepository, tenantSettingsRepository, secretCipher, objectMapper, Clock.systemUTC());
    }

    EmrHmacAuthenticationFilter(PharmacyRepository pharmacyRepository,
                                TenantSettingsRepository tenantSettingsRepository,
                                EmrSecretCipher secretCipher,
                                ObjectMapper objectMapper, Clock clock) {
        this.pharmacyRepository = pharmacyRepository;
        this.tenantSettingsRepository = tenantSettingsRepository;
        this.secretCipher = secretCipher;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Override
    protected boolean shouldNotFilter(@NonNull HttpServletRequest request) {
        return !request.getRequestURI().startsWith(ROUTE_PREFIX);
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain chain) throws ServletException, IOException {
        if (!secretCipher.isConfigured()) {
            reject(response, HttpServletResponse.SC_SERVICE_UNAVAILABLE, "EMR integration is not configured");
            return;
        }

        String pharmacyId = request.getHeader(PHARMACY_HEADER);
        String timestamp = request.getHeader(TIMESTAMP_HEADER);
        String signature = request.getHeader(SIGNATURE_HEADER);
        if (pharmacyId == null || pharmacyId.isBlank() || timestamp == null || signature == null) {
            reject(response, HttpServletResponse.SC_UNAUTHORIZED, "Missing EMR authentication headers");
            return;
        }

        long epochSeconds;
        try {
            epochSeconds = Long.parseLong(timestamp);
        } catch (NumberFormatException e) {
            reject(response, HttpServletResponse.SC_UNAUTHORIZED, "Invalid EMR authentication timestamp");
            return;
        }
        if (Math.abs(clock.instant().getEpochSecond() - epochSeconds) > MAX_CLOCK_SKEW_SECONDS) {
            reject(response, HttpServletResponse.SC_UNAUTHORIZED, "Expired EMR authentication timestamp");
            return;
        }

        // Each pharmacy verifies against its own decrypted secret, gated on
        // TenantSettings.enableEmr — never a process-wide secret. Every failure
        // path below (unknown pharmacy, EMR disabled, no secret rotated yet, or
        // a genuine signature mismatch) returns the same generic message so the
        // response can't be used as a pharmacy-id or feature-flag oracle.
        String secret = resolveSecret(pharmacyId);
        if (secret == null) {
            reject(response, HttpServletResponse.SC_UNAUTHORIZED, "Invalid EMR authentication signature");
            return;
        }

        byte[] body = request.getInputStream().readNBytes(MAX_SIGNED_BODY_BYTES + 1);
        if (body.length > MAX_SIGNED_BODY_BYTES) {
            reject(response, HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE, "EMR request body is too large");
            return;
        }
        String expected = HmacSigner.sign(secret, timestamp, request.getMethod(), request.getRequestURI(),
                pharmacyId, body);
        if (!HmacSigner.verify(expected, signature)) {
            reject(response, HttpServletResponse.SC_UNAUTHORIZED, "Invalid EMR authentication signature");
            return;
        }

        UserPrincipal principal = new UserPrincipal("emr-integration", pharmacyId, Role.OWNER, "emr@machine.local");
        var authentication = new UsernamePasswordAuthenticationToken(principal, null,
                List.of(new SimpleGrantedAuthority("ROLE_OWNER")));
        SecurityContextHolder.getContext().setAuthentication(authentication);
        MDC.put("userId", principal.userId());
        MDC.put("pharmacyId", pharmacyId);
        chain.doFilter(new CachedBodyRequest(request, body), response);
    }

    /** Null if the pharmacy is unknown, EMR isn't enabled for it, or it has no secret rotated yet. */
    private String resolveSecret(String pharmacyId) {
        Optional<Pharmacy> pharmacy = pharmacyRepository.findById(pharmacyId);
        if (pharmacy.isEmpty() || !pharmacy.get().isActive()) return null;
        boolean enabled = tenantSettingsRepository.findByPharmacyId(pharmacyId)
                .map(settings -> settings.isEnableEmr()).orElse(false);
        if (!enabled) return null;
        Pharmacy p = pharmacy.get();
        if (p.getEmrSecretCiphertext() == null || p.getEmrSecretIv() == null || p.getEmrSecretTag() == null) {
            return null;
        }
        try {
            return secretCipher.decrypt(p.getEmrSecretCiphertext(), p.getEmrSecretIv(), p.getEmrSecretTag());
        } catch (Exception e) {
            return null;
        }
    }

    private void reject(HttpServletResponse response, int status, String message) throws IOException {
        response.setStatus(status);
        response.setCharacterEncoding("UTF-8");
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getWriter(), ApiResponse.fail(message));
    }

    private static final class CachedBodyRequest extends HttpServletRequestWrapper {
        private final byte[] body;

        private CachedBodyRequest(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream input = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override public boolean isFinished() { return input.available() == 0; }
                @Override public boolean isReady() { return true; }
                @Override public void setReadListener(ReadListener readListener) { }
                @Override public int read() { return input.read(); }
            };
        }
    }
}
