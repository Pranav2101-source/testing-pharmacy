package com.checkup.pharmacy.common.concurrency;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Retries a transactional method when it loses a race for contended rows,
 * instead of surfacing the loss to the user as a 409.
 *
 * <p>Contention on stock rows is <b>normal</b>, not exceptional: two counters in
 * the same shop selling the last strips of a fast-moving medicine will collide
 * routinely. Before this existed, one of them was simply told "please try again"
 * — the pharmacist re-keyed the sale while a customer waited. A serialization
 * failure or deadlock is transient by definition, so the correct response is to
 * replay the transaction, not to delegate the retry to a human.
 *
 * <p><b>Applies only to retryable failures.</b> The aspect retries Postgres
 * {@code serialization_failure} (40001), {@code deadlock_detected} (40P01), and
 * lock-acquisition timeouts. Business failures — insufficient stock, validation
 * errors, not-found — are never retried; replaying them would just fail again
 * more slowly.
 *
 * <p><b>Safe to replay.</b> The annotated method must be the whole transaction,
 * so a failed attempt has already been rolled back completely before the next
 * one starts. Do not put this on a method that performs non-transactional side
 * effects (sending mail, calling a payment gateway); those would happen twice.
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface RetryOnConflict {

    /** Total attempts, including the first. */
    int maxAttempts() default 4;

    /** Base backoff in milliseconds; grows exponentially with full jitter. */
    long baseBackoffMillis() default 25L;
}
