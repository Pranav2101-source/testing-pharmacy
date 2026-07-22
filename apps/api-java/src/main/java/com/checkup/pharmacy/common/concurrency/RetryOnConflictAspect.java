package com.checkup.pharmacy.common.concurrency;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.aop.support.AopUtils;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.core.annotation.Order;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.stereotype.Component;

import java.lang.reflect.Method;
import java.sql.SQLException;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Implements {@link RetryOnConflict}.
 *
 * <p><b>Ordering.</b> This must sit <i>outside</i> Spring's transaction
 * interceptor, so each attempt gets a genuinely new transaction. Retrying inside
 * a transaction that has already been marked rollback-only would fail on commit
 * every time, no matter how many attempts were made. {@code HIGHEST_PRECEDENCE + 10}
 * places it after {@code CrossTenantAspect} (which must remain outermost so
 * elevation is visible when each attempt begins) and before the transaction
 * advice.
 *
 * <p><b>Full jitter.</b> Backoff is {@code random(0, base * 2^attempt)} rather
 * than a fixed doubling. Deterministic backoff makes contending transactions
 * retry in lockstep and collide again — the classic thundering herd. Randomising
 * the whole interval spreads them out, which matters most in exactly the case
 * this exists for: several terminals hitting the same batch at once.
 */
@Aspect
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class RetryOnConflictAspect {

    private static final Logger log = LoggerFactory.getLogger(RetryOnConflictAspect.class);

    /** Postgres: serialization_failure — the SQLSTATE a failed SERIALIZABLE txn raises. */
    private static final String SQLSTATE_SERIALIZATION_FAILURE = "40001";
    /** Postgres: deadlock_detected. */
    private static final String SQLSTATE_DEADLOCK_DETECTED = "40P01";
    /** Postgres: lock_not_available — SELECT ... FOR UPDATE NOWAIT/timeout. */
    private static final String SQLSTATE_LOCK_NOT_AVAILABLE = "55P03";

    /** Ceiling on the computed backoff so a pathological attempt count can't stall a request. */
    private static final long MAX_BACKOFF_MILLIS = 500L;

    /**
     * Carrier for the annotation's declared defaults, used only as a fallback when
     * reflection cannot recover the real annotation. Reading them off a dummy method
     * keeps the defaults defined in exactly one place — the annotation itself —
     * rather than duplicated here and silently drifting.
     */
    @SuppressWarnings("unused")
    @RetryOnConflict
    private static void defaultsCarrier() {
    }

    private static final RetryOnConflict DEFAULTS = defaultsAnnotation();

    private static RetryOnConflict defaultsAnnotation() {
        try {
            return RetryOnConflictAspect.class
                    .getDeclaredMethod("defaultsCarrier")
                    .getAnnotation(RetryOnConflict.class);
        } catch (NoSuchMethodException e) {
            throw new IllegalStateException("defaultsCarrier() is missing — it backs RetryOnConflict's defaults", e);
        }
    }

    /**
     * Resolves the annotation by reflection rather than binding it as an advice
     * parameter. The binding form fails at runtime with "JoinPointMatch was NOT
     * bound in invocation" once the advised bean carries another proxy, which every
     * {@code @Transactional} service here does.
     */
    @Around("@annotation(com.checkup.pharmacy.common.concurrency.RetryOnConflict)")
    public Object around(ProceedingJoinPoint joinPoint) throws Throwable {
        return retryOnConflict(joinPoint, resolveAnnotation(joinPoint));
    }

    /**
     * Reads the annotation off the <i>target class</i>'s method, not the signature's.
     * On a CGLIB proxy the signature can resolve to a bridge or interface method
     * that carries no annotations, which would silently yield null and skip retries.
     */
    private RetryOnConflict resolveAnnotation(ProceedingJoinPoint joinPoint) {
        MethodSignature signature = (MethodSignature) joinPoint.getSignature();
        Class<?> targetClass = joinPoint.getTarget() != null
                ? joinPoint.getTarget().getClass()
                : signature.getDeclaringType();
        Method method = AopUtils.getMostSpecificMethod(signature.getMethod(), targetClass);
        RetryOnConflict retry = AnnotatedElementUtils.findMergedAnnotation(method, RetryOnConflict.class);
        if (retry != null) {
            return retry;
        }
        // Should be unreachable — the pointcut only matches annotated methods — but
        // falling back to the declared defaults is safer than a NullPointerException
        // on a money path.
        return DEFAULTS;
    }

    /** Package-private for direct unit testing without a proxy. */
    Object retryOnConflict(ProceedingJoinPoint joinPoint, RetryOnConflict retry) throws Throwable {
        String operation = joinPoint.getSignature().toShortString();
        int maxAttempts = Math.max(1, retry.maxAttempts());
        Throwable lastFailure = null;

        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return joinPoint.proceed();
            } catch (Throwable t) {
                if (!isRetryable(t)) {
                    throw t;
                }
                lastFailure = t;
                if (attempt == maxAttempts) {
                    break;
                }
                long backoff = backoffMillis(retry.baseBackoffMillis(), attempt);
                log.warn("{} lost a write race (attempt {}/{}), retrying in {}ms",
                        operation, attempt, maxAttempts, backoff);
                sleep(backoff);
            }
        }

        log.error("{} still conflicting after {} attempts — surfacing to caller",
                operation, maxAttempts, lastFailure);
        throw lastFailure;
    }

    /**
     * True for transient write races only. Anything else — a business rule, a
     * constraint violation, a bug — must propagate on the first attempt.
     */
    private boolean isRetryable(Throwable t) {
        for (Throwable c = t; c != null; c = c.getCause()) {
            if (c instanceof ConcurrencyFailureException
                    || c instanceof CannotAcquireLockException
                    || c instanceof PessimisticLockingFailureException) {
                return true;
            }
            if (c instanceof SQLException sqlException) {
                String state = sqlException.getSQLState();
                if (SQLSTATE_SERIALIZATION_FAILURE.equals(state)
                        || SQLSTATE_DEADLOCK_DETECTED.equals(state)
                        || SQLSTATE_LOCK_NOT_AVAILABLE.equals(state)) {
                    return true;
                }
            }
            // Defensive: a self-referencing cause chain would otherwise spin forever.
            if (c.getCause() == c) {
                break;
            }
        }
        return false;
    }

    private long backoffMillis(long base, int attempt) {
        long ceiling = Math.min(MAX_BACKOFF_MILLIS, base * (1L << Math.min(attempt, 16)));
        // Bound must be strictly positive for nextLong.
        return ThreadLocalRandom.current().nextLong(1, Math.max(2, ceiling));
    }

    private void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            // Preserve the interrupt for the container rather than swallowing it,
            // so a shutdown mid-retry is not silently ignored.
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while backing off before retry", e);
        }
    }
}
