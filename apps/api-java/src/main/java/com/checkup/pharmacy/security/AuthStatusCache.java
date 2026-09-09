package com.checkup.pharmacy.security;

import com.checkup.pharmacy.modules.user.AuthStatus;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Optional;
import java.util.function.Supplier;

/**
 * In-process cache for {@link JwtAuthenticationFilter}'s revocation check — the single
 * most-executed query in the system (one {@code findAuthStatusById} per authenticated
 * request, and against a small connection pool its cost sets a ceiling on everything else).
 *
 * <p><b>Correctness model: short TTL as the backstop, explicit eviction as the fast path.</b>
 * The cache is keyed on {@code userId} and holds {@code (isActive, tokenVersion)}. Every
 * revocation path in the app increments {@code tokenVersion} — logout, password change,
 * refresh rotation, {@code User.deactivate()}, and the bulk tenant force-logout — and each
 * of those call sites also calls {@link #invalidate}/{@link #invalidateAll} here, so a
 * revoked session stops working immediately on this instance. The {@code expireAfterWrite}
 * TTL (default 20s) is the safety net for a missed eviction and the hard ceiling on
 * cross-instance staleness until a shared eviction channel is added.
 *
 * <p>Caffeine, not Redis: no network hop on the hottest path, and no extra load on the
 * single shared Redis instance.
 */
@Component
public class AuthStatusCache {

    private static final Logger log = LoggerFactory.getLogger(AuthStatusCache.class);

    private final Cache<String, AuthStatus> cache;

    public AuthStatusCache(
            @Value("${app.auth.status-cache.ttl-seconds:20}") long ttlSeconds,
            @Value("${app.auth.status-cache.max-size:200000}") long maxSize) {
        this.cache = Caffeine.newBuilder()
                .maximumSize(maxSize)
                .expireAfterWrite(Duration.ofSeconds(ttlSeconds))
                .recordStats()
                .build();
    }

    /**
     * The cached status for {@code userId}, or a fresh load via {@code dbLoader} on a miss.
     * A present result is always cached (including an inactive user — the filter rejects it
     * either way, and caching it stops a disabled account from hammering the DB on retry);
     * an absent user (row gone) is never cached.
     */
    public Optional<AuthStatus> resolve(String userId, Supplier<Optional<AuthStatus>> dbLoader) {
        AuthStatus hit = cache.getIfPresent(userId);
        if (hit != null) {
            return Optional.of(hit);
        }
        Optional<AuthStatus> loaded = dbLoader.get();
        loaded.ifPresent(s -> cache.put(userId, s));
        return loaded;
    }

    /** Drop this user's entry — called from every path that bumps their tokenVersion. */
    public void invalidate(String userId) {
        if (userId != null) {
            cache.invalidate(userId);
        }
    }

    /** Drop everything — for a pharmacy-wide force-logout and an ops break-glass. */
    public void invalidateAll() {
        long n = cache.estimatedSize();
        cache.invalidateAll();
        if (n > 0) {
            log.info("AuthStatusCache fully invalidated ({} entries dropped)", n);
        }
    }

    public com.github.benmanes.caffeine.cache.stats.CacheStats stats() {
        return cache.stats();
    }

    public long estimatedSize() {
        return cache.estimatedSize();
    }
}
