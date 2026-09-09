package com.checkup.pharmacy.security;

import com.checkup.pharmacy.modules.user.AuthStatus;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The in-process cache in front of the auth filter's revocation read.
 *
 * <p>Pins the two properties that make it safe to sit on the hottest path in the app:
 * a hit skips the loader entirely, and every revocation call site can drop the entry so
 * the next request re-reads.
 */
class AuthStatusCacheTest {

    private final AuthStatusCache cache = new AuthStatusCache(20, 10_000);

    @Test
    @DisplayName("a second lookup for the same user is served from cache — the DB loader runs once")
    void secondLookupIsCached() {
        AtomicInteger dbHits = new AtomicInteger();
        var loader = (java.util.function.Supplier<Optional<AuthStatus>>) () -> {
            dbHits.incrementAndGet();
            return Optional.of(new AuthStatus(true, 3));
        };

        var first = cache.resolve("user-1", loader);
        var second = cache.resolve("user-1", loader);
        var third = cache.resolve("user-1", loader);

        assertThat(first).contains(new AuthStatus(true, 3));
        assertThat(second).contains(new AuthStatus(true, 3));
        assertThat(third).contains(new AuthStatus(true, 3));
        assertThat(dbHits.get()).as("loaded from the database exactly once").isEqualTo(1);
        assertThat(cache.stats().hitCount()).isGreaterThanOrEqualTo(2);
    }

    @Test
    @DisplayName("invalidate forces the next lookup back to the database — this is how revocation stays instant")
    void invalidateForcesReload() {
        AtomicInteger dbHits = new AtomicInteger();
        var loader = (java.util.function.Supplier<Optional<AuthStatus>>) () -> {
            dbHits.incrementAndGet();
            return Optional.of(new AuthStatus(true, dbHits.get()));
        };

        cache.resolve("user-2", loader);   // db hit 1 -> version 1
        cache.resolve("user-2", loader);   // cached
        cache.invalidate("user-2");        // e.g. logout bumped tokenVersion
        var afterInvalidate = cache.resolve("user-2", loader); // db hit 2 -> version 2

        assertThat(dbHits.get()).isEqualTo(2);
        assertThat(afterInvalidate).contains(new AuthStatus(true, 2));
    }

    @Test
    @DisplayName("a missing user is never cached — a deleted row must not be pinned as 'gone' for the TTL")
    void absentUserIsNotCached() {
        AtomicInteger dbHits = new AtomicInteger();
        var loader = (java.util.function.Supplier<Optional<AuthStatus>>) () -> {
            dbHits.incrementAndGet();
            return Optional.empty();
        };

        cache.resolve("ghost", loader);
        cache.resolve("ghost", loader);

        assertThat(dbHits.get()).as("empty results bypass the cache entirely").isEqualTo(2);
        assertThat(cache.estimatedSize()).isZero();
    }

    @Test
    @DisplayName("invalidateAll clears the whole cache — the pharmacy-wide force-logout path")
    void invalidateAllClearsEverything() {
        var loader = (java.util.function.Supplier<Optional<AuthStatus>>) () -> Optional.of(new AuthStatus(true, 1));
        cache.resolve("a", loader);
        cache.resolve("b", loader);
        assertThat(cache.estimatedSize()).isEqualTo(2);

        cache.invalidateAll();

        assertThat(cache.estimatedSize()).isZero();
    }
}
