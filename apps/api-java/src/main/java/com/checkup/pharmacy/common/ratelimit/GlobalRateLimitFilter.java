package com.checkup.pharmacy.common.ratelimit;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.common.util.ClientIp;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;

/**
 * A generous, blanket per-IP request ceiling — basic scripted-abuse/DoS protection for the
 * whole API surface, layered ON TOP OF (not instead of) the tighter per-endpoint limits in
 * {@link com.checkup.pharmacy.modules.auth.AuthController} (login/register/forgot-password).
 * Those stay in place unchanged; this just catches everything else (billing, inventory
 * writes, etc.) that had no rate limiting at all.
 *
 * The limit is deliberately generous (400/min by default) because a single pharmacy's whole
 * staff — several POS terminals, a manager's laptop, a phone checking stock — commonly shares
 * one NAT IP behind one router. A tight global limit would risk locking out an entire
 * location's legitimate traffic during a busy shift; this is sized to only catch a scripted
 * attacker firing far faster than any real staff workflow could.
 *
 * Runs immediately after {@link com.checkup.pharmacy.common.logging.RequestIdFilter} — a
 * rejected request still gets a request id and an access-log line (worth seeing in ops), but
 * rejection happens before Spring Security's JWT verification / DB lookups, so an attacker
 * can't burn those resources by being rate-limited.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
public class GlobalRateLimitFilter extends OncePerRequestFilter {

    private final RateLimitService rateLimitService;
    private final ObjectMapper objectMapper;
    private final int limit;
    private final Duration window = Duration.ofMinutes(1);

    public GlobalRateLimitFilter(RateLimitService rateLimitService, ObjectMapper objectMapper,
                                 @Value("${app.ratelimit.global-per-ip-per-minute:400}") int limit) {
        this.rateLimitService = rateLimitService;
        this.objectMapper = objectMapper;
        this.limit = limit;
    }

    @Override
    protected boolean shouldNotFilter(@NonNull HttpServletRequest request) {
        // Health checks are polled automatically (monitoring, load balancers) and are cheap —
        // exempting them avoids an infra probe ever tripping this for everyone behind the same IP.
        return "/api/v1/health".equals(request.getRequestURI());
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response,
                                    @NonNull FilterChain filterChain) throws ServletException, IOException {
        String ip = ClientIp.from(request);
        if (rateLimitService.tryConsume("global:ip:" + ip, limit, window)) {
            filterChain.doFilter(request, response);
            return;
        }
        // HttpServletResponse predates RFC 6585 and has no SC_TOO_MANY_REQUESTS constant.
        response.setStatus(429);
        // The servlet spec defaults the writer to ISO-8859-1, not UTF-8 — without this, the
        // em dash below (and any other non-ASCII character in any message using this same
        // raw-response-writing pattern) silently mangles into "?".
        response.setCharacterEncoding("UTF-8");
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getWriter(), ApiResponse.fail("Too many requests — please slow down"));
    }
}
