package com.checkup.pharmacy.common.logging;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

/**
 * Assigns every request a correlation id — reused from the caller's {@code X-Request-Id}
 * header if present (so a request can be traced end-to-end across services), otherwise
 * generated fresh. Placed in MDC so every log line for this request carries it (the JSON
 * encoder in logback-spring.xml includes all MDC keys automatically), and echoed back in
 * the response header so the caller can correlate their own logs against ours.
 *
 * Also emits one access-log line per request (method/path/status/duration) — without it,
 * a successful request produces zero log output at all, which makes the request id useless
 * for anything but chasing errors. Logged here (the outermost filter, wrapping even Spring
 * Security) rather than in a controller/service, so every request is covered regardless of
 * whether it ever reaches a controller (a 401/403/404 still gets logged).
 *
 * Runs at the highest precedence so it wraps the entire filter chain; its finally block is
 * therefore also the right place to clear every per-request MDC key (requestId here, plus
 * userId/pharmacyId set by JwtAuthenticationFilter) — Tomcat reuses worker threads across
 * requests, so anything left in MDC would leak into the next unrelated request on that thread.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger("http.access");

    private static final String HEADER = "X-Request-Id";
    private static final String MDC_KEY = "requestId";

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response,
                                    @NonNull FilterChain filterChain) throws ServletException, IOException {
        String requestId = request.getHeader(HEADER);
        if (requestId == null || requestId.isBlank()) {
            requestId = UUID.randomUUID().toString();
        }
        MDC.put(MDC_KEY, requestId);
        response.setHeader(HEADER, requestId);
        long start = System.currentTimeMillis();
        try {
            filterChain.doFilter(request, response);
        } finally {
            long durationMs = System.currentTimeMillis() - start;
            log.info("{} {} -> {} ({}ms)", request.getMethod(), request.getRequestURI(), response.getStatus(), durationMs);
            MDC.remove(MDC_KEY);
            MDC.remove("userId");
            MDC.remove("pharmacyId");
        }
    }
}
