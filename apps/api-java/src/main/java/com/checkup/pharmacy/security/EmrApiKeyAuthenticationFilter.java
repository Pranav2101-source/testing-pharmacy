package com.checkup.pharmacy.security;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.http.MediaType;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Optional;

/**
 * Authenticates the compatibility EMR surface, where a clinic presents an API key and
 * secret rather than signing each request.
 *
 * <h2>Why a second scheme exists at all</h2>
 * {@link EmrHmacAuthenticationFilter} is the preferred contract and is unchanged. The
 * clinic's existing client authenticates with a key/secret pair, and making the other
 * product change first would block this integration on a deploy nobody here controls. The
 * pharmacy speaks both instead: same engine behind them, different doors.
 *
 * <h2>Why the trailing slash in the prefix matters</h2>
 * {@code /api/v1/integration} is a strict prefix of {@code /api/v1/integrations}. Matching
 * on {@code "/api/v1/integration"} would therefore also match every HMAC route, and both
 * filters would run on the same request — the second one overwriting the first's
 * authentication, or rejecting a request the first had already accepted. The trailing
 * slash makes the two prefixes disjoint, and they must stay that way.
 *
 * <p>Both filters set the same principal shape, so everything downstream — tenant scoping,
 * RLS, auditing — is identical regardless of which door a request came through.
 */
@Component
public class EmrApiKeyAuthenticationFilter extends OncePerRequestFilter {

    public static final String KEY_HEADER = "X-API-KEY";
    public static final String SECRET_HEADER = "X-API-SECRET";

    /**
     * Trailing slash is load-bearing — see the class comment. The pairing route below is
     * the one path under this prefix that must stay reachable without a credential, since
     * it is where credentials come from.
     */
    static final String ROUTE_PREFIX = "/api/v1/integration/";
    static final String PAIR_PATH = "/api/v1/integration/pair";

    private final PharmacyRepository pharmacyRepository;
    private final ObjectMapper objectMapper;

    public EmrApiKeyAuthenticationFilter(PharmacyRepository pharmacyRepository, ObjectMapper objectMapper) {
        this.pharmacyRepository = pharmacyRepository;
        this.objectMapper = objectMapper;
    }

    @Override
    protected boolean shouldNotFilter(@NonNull HttpServletRequest request) {
        String uri = request.getRequestURI();
        // Pairing bootstraps the credential, so it cannot require one. It is not
        // unauthenticated: the pairing code itself is the proof, checked against the
        // pharmacy's own generated key inside the service.
        return !uri.startsWith(ROUTE_PREFIX) || uri.equals(PAIR_PATH);
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain chain) throws ServletException, IOException {
        String apiKey = request.getHeader(KEY_HEADER);
        String apiSecret = request.getHeader(SECRET_HEADER);
        if (apiKey == null || apiKey.isBlank() || apiSecret == null || apiSecret.isBlank()) {
            reject(response, "Missing API credentials");
            return;
        }

        // Every failure below — unknown key, inactive pharmacy, wrong secret — returns the
        // same message. A response that distinguished "no such key" from "wrong secret"
        // would confirm which keys exist, turning the endpoint into an oracle for the half
        // of the credential that travels in the clear.
        Optional<Pharmacy> found = pharmacyRepository.findByEmrApiKey(apiKey);
        if (found.isEmpty() || !found.get().isActive()
                || !ApiSecretHasher.matches(apiSecret, found.get().getEmrApiSecretHash())) {
            reject(response, "Invalid API credentials");
            return;
        }

        String pharmacyId = found.get().getId();
        UserPrincipal principal = new UserPrincipal("emr-integration", pharmacyId, Role.OWNER,
                "emr@machine.local");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(principal, null,
                        List.of(new SimpleGrantedAuthority("ROLE_OWNER"))));
        MDC.put("userId", principal.userId());
        MDC.put("pharmacyId", pharmacyId);
        chain.doFilter(request, response);
    }

    private void reject(HttpServletResponse response, String message) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setCharacterEncoding("UTF-8");
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getWriter(), ApiResponse.fail(message));
    }
}
