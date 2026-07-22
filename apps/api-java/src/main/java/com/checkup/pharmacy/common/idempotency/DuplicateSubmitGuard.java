package com.checkup.pharmacy.common.idempotency;

import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.tenant.TenantContext;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;

/**
 * A backstop against double-clicked / accidentally-resubmitted create requests on endpoints
 * that have no natural unique key to fall back on (customer, supplier, doctor, PO, quotation,
 * calendar event, support ticket, supplier payment/return/credit-note). The frontend disables
 * its submit buttons while a request is in flight, but that's a UI guard, not a guarantee — a
 * slow network, a hard refresh mid-submit, or a scripted client can still fire the same create
 * twice.
 *
 * <p>Mechanism: fingerprint {@code (pharmacyId, userId, action, request-body)} and reject a
 * second identical submission seen within a short window via a Redis {@code SET key NX EX}.
 * Deliberately NOT the full billing-style idempotency-key mechanism (that needs a dedicated DB
 * column + a client-supplied key, i.e. a Prisma schema change and a frontend change) — this is
 * the schema-free, frontend-free equivalent that catches the realistic double-submit.
 *
 * <p>Fails OPEN: if Redis is unavailable or the payload can't be serialized, the create simply
 * proceeds — this must never take down a legitimate create just because a dedup check couldn't run.
 * The tradeoff is that an identical request that legitimately FAILED (e.g. transient error) is
 * blocked from an identical retry for the window's duration; the window is kept short for that reason.
 */
@Component
public class DuplicateSubmitGuard {

    private static final Logger log = LoggerFactory.getLogger(DuplicateSubmitGuard.class);
    private static final Duration WINDOW = Duration.ofSeconds(10);

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    public DuplicateSubmitGuard(StringRedisTemplate redisTemplate, ObjectMapper objectMapper) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    /**
     * @param action a short, stable name for the operation (e.g. {@code "customer.create"}) so
     *               fingerprints from different endpoints never collide.
     * @param payload the request DTO — serialized to JSON to form the fingerprint.
     */
    public void guard(String action, Object payload) {
        String fingerprint;
        try {
            fingerprint = sha256(objectMapper.writeValueAsString(payload));
        } catch (Exception e) {
            return; // can't fingerprint → don't block a real create
        }

        String key = "idem:" + action + ":" + TenantContext.pharmacyId() + ":" + TenantContext.userId()
                + ":" + fingerprint;

        Boolean firstTime;
        try {
            firstTime = redisTemplate.opsForValue().setIfAbsent(key, "1", WINDOW);
        } catch (Exception e) {
            log.warn("Duplicate-submit check failed for action '{}' — failing open", action, e);
            return; // Redis down → fail open
        }

        if (Boolean.FALSE.equals(firstTime)) {
            throw new ConflictException(
                    "This looks like a duplicate submission — please wait a moment and check before retrying.");
        }
    }

    private static String sha256(String value) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
