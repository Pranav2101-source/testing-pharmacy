package com.checkup.pharmacy.common.ratelimit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;

/**
 * Redis-backed fixed-window rate limiter (A4) — {@code INCR} a per-window counter,
 * setting its TTL only on the very first increment in that window. Simple and cheap
 * (two Redis round-trips at most, one on the common path), at the cost of the classic
 * fixed-window edge case (a burst straddling the window boundary can briefly allow up
 * to ~2x the limit) — an acceptable tradeoff for the login/registration abuse-prevention
 * use case here, which cares about "roughly this many attempts per window", not exact
 * enforcement.
 *
 * Fails OPEN on any Redis error: rate limiting is a security nicety layered on top of
 * the real auth logic, not something that should take down login for every user the
 * moment Redis has a blip.
 */
@Service
public class RateLimitService {

    private static final Logger log = LoggerFactory.getLogger(RateLimitService.class);

    private final StringRedisTemplate redisTemplate;

    public RateLimitService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /** Returns true if this call is within the limit (and should proceed), false if it should be rejected. */
    public boolean tryConsume(String key, int limit, Duration window) {
        try {
            String redisKey = "ratelimit:" + key;
            Long count = redisTemplate.opsForValue().increment(redisKey);
            if (count != null && count == 1L) {
                redisTemplate.expire(redisKey, window);
            }
            return count == null || count <= limit;
        } catch (Exception e) {
            log.warn("Rate limit check failed for key '{}' — failing open", key, e);
            return true;
        }
    }
}
