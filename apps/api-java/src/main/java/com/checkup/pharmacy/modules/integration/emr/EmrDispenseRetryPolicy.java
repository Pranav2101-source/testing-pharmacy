package com.checkup.pharmacy.modules.integration.emr;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * How long to wait before trying a failed callback again, and when to stop.
 *
 * <p>The shape matters more than the numbers: minutes early, hours later. Most failures
 * are a restart or a blip and clear within minutes, so the first retries are close
 * together; the ones that survive an hour are usually a misconfiguration nobody has
 * noticed yet, and hammering those buys nothing.
 *
 * <p>The series ends. An endpoint that has been unreachable for a day is not going to be
 * fixed by a nineteenth attempt, and a queue that never drains hides the failures that
 * are still actionable. Giving up is visible — the prescription stays FAILED with nothing
 * scheduled, which is exactly what the pharmacist's panel offers a Retry button for.
 */
final class EmrDispenseRetryPolicy {

    private static final Duration[] BACKOFF = {
            Duration.ofMinutes(1),
            Duration.ofMinutes(5),
            Duration.ofMinutes(15),
            Duration.ofHours(1),
            Duration.ofHours(3),
            Duration.ofHours(6),
            Duration.ofHours(12),
    };

    /** Attempts allowed in total: the first delivery, plus one per backoff step. */
    static final int MAX_ATTEMPTS = BACKOFF.length + 1;

    private EmrDispenseRetryPolicy() {
    }

    /**
     * @param attemptsSoFar attempts already made, including the one that just failed.
     * @return when to try next, or empty when the budget is spent.
     */
    static Optional<Instant> nextAttemptAfter(int attemptsSoFar, Instant now) {
        // Defensive at both ends: a negative would index out of the array, and a count past
        // the end is exactly the give-up case. Neither should happen, and neither should
        // throw on a background thread if it does.
        if (attemptsSoFar < 1 || attemptsSoFar > BACKOFF.length) {
            return Optional.empty();
        }
        return Optional.of(now.plus(BACKOFF[attemptsSoFar - 1]));
    }
}
