package com.checkup.pharmacy.modules.integration.emr;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The backoff schedule, asserted rather than described.
 *
 * <p>Worth testing because both ends of it are silent failures. Retry too eagerly and a
 * dead endpoint gets hammered while its own operators are trying to fix it; give up too
 * early and a clinic's charts stay wrong after a blip that cleared in minutes. Neither
 * shows up in a log — the numbers are only visible by reading them here.
 */
class EmrDispenseRetryPolicyTest {

    private static final Instant NOW = Instant.parse("2026-08-19T10:00:00Z");

    @Test
    @DisplayName("the first retry is a minute out, not immediate")
    void firstRetryIsShort() {
        assertThat(EmrDispenseRetryPolicy.nextAttemptAfter(1, NOW))
                .contains(NOW.plus(Duration.ofMinutes(1)));
    }

    @Test
    @DisplayName("the gap widens with each failure")
    void backoffGrowsMonotonically() {
        Instant previous = NOW;
        for (int attempts = 1; attempts <= EmrDispenseRetryPolicy.MAX_ATTEMPTS - 1; attempts++) {
            Instant next = EmrDispenseRetryPolicy.nextAttemptAfter(attempts, NOW).orElseThrow();
            assertThat(next)
                    .as("attempt %d must be scheduled later than attempt %d", attempts, attempts - 1)
                    .isAfter(previous);
            previous = next;
        }
    }

    @Test
    @DisplayName("the schedule gives up rather than retrying for ever")
    void stopsAfterTheLastStep() {
        // The give-up point is the whole reason a pharmacist ever sees a Retry button: a
        // queue that never drains would hide the failures that are still actionable.
        assertThat(EmrDispenseRetryPolicy.nextAttemptAfter(EmrDispenseRetryPolicy.MAX_ATTEMPTS, NOW))
                .as("the budget is spent once every backoff step has been used")
                .isEmpty();
    }

    @Test
    @DisplayName("the last scheduled attempt is at least half a day out")
    void tailIsLongEnoughToBeWorthIt() {
        // Guards against someone shortening the tail into uselessness: an endpoint broken for
        // hours is a configuration problem, and retrying it every few minutes until the cap is
        // reached would exhaust the budget long before anyone has looked at it.
        Instant last = EmrDispenseRetryPolicy
                .nextAttemptAfter(EmrDispenseRetryPolicy.MAX_ATTEMPTS - 1, NOW).orElseThrow();
        assertThat(last).isAfterOrEqualTo(NOW.plus(Duration.ofHours(12)));
    }

    @Test
    @DisplayName("a nonsensical attempt count is refused rather than thrown from")
    void refusesOutOfRangeCounts() {
        // This runs on a background thread where an exception is only ever noise in a log, so
        // both ends are defended: zero would index before the array, and a count past the end
        // is exactly the give-up case.
        assertThat(EmrDispenseRetryPolicy.nextAttemptAfter(0, NOW)).isEmpty();
        assertThat(EmrDispenseRetryPolicy.nextAttemptAfter(-1, NOW)).isEmpty();
        assertThat(EmrDispenseRetryPolicy.nextAttemptAfter(999, NOW)).isEmpty();
    }
}
