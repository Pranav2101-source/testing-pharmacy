package com.checkup.pharmacy.common.concurrency;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.Signature;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.dao.DataIntegrityViolationException;

import java.sql.SQLException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Behaviour of the retry that sits in front of every stock-mutating transaction.
 *
 * <p>These matter because the aspect fails in two opposite and equally bad ways.
 * Retry too little and two counters selling the same medicine hand a 409 to a
 * pharmacist with a customer waiting. Retry too much — specifically, retry a
 * <i>business</i> failure such as insufficient stock — and the system hammers the
 * database re-running a transaction that can never succeed, turning a clean
 * rejection into a slow one under exactly the load that caused it.
 */
@DisplayName("RetryOnConflict: transient write races are replayed, business failures are not")
class RetryOnConflictAspectTest {

    private RetryOnConflictAspect aspect;
    private RetryOnConflict annotation;

    /** Carrier for a real annotation instance with the production defaults. */
    private static final class Annotated {
        @RetryOnConflict(baseBackoffMillis = 1) // keep the suite fast; ordering logic is unchanged
        void operation() {
        }
    }

    @BeforeEach
    void setUp() throws NoSuchMethodException {
        aspect = new RetryOnConflictAspect();
        annotation = Annotated.class.getDeclaredMethod("operation").getAnnotation(RetryOnConflict.class);
    }

    private ProceedingJoinPoint joinPointThatFails(int failures, Throwable failure, Object result) throws Throwable {
        ProceedingJoinPoint joinPoint = mock(ProceedingJoinPoint.class);
        Signature signature = mock(Signature.class);
        when(signature.toShortString()).thenReturn("BillingService.createInvoice(..)");
        when(joinPoint.getSignature()).thenReturn(signature);

        int[] calls = {0};
        when(joinPoint.proceed()).thenAnswer(invocation -> {
            if (calls[0]++ < failures) {
                throw failure;
            }
            return result;
        });
        return joinPoint;
    }

    @Test
    @DisplayName("succeeds on a later attempt after losing a serialization race")
    void retriesSerializationFailureThenSucceeds() throws Throwable {
        ProceedingJoinPoint joinPoint =
                joinPointThatFails(2, new ConcurrencyFailureException("serialization failure"), "INVOICE-1");

        Object result = aspect.retryOnConflict(joinPoint, annotation);

        assertEquals("INVOICE-1", result, "the third attempt should have committed");
    }

    @Test
    @DisplayName("retries a raw Postgres deadlock (40P01) reported via SQLState")
    void retriesDeadlockBySqlState() throws Throwable {
        // Not every failure arrives pre-translated into Spring's DataAccessException
        // hierarchy; a driver-level SQLException must be recognised on SQLState too.
        SQLException deadlock = new SQLException("deadlock detected", "40P01");
        ProceedingJoinPoint joinPoint =
                joinPointThatFails(1, new RuntimeException("wrapped", deadlock), "OK");

        assertEquals("OK", aspect.retryOnConflict(joinPoint, annotation));
    }

    @Test
    @DisplayName("does NOT retry a business failure — it would never succeed")
    void doesNotRetryBusinessFailures() throws Throwable {
        IllegalStateException insufficientStock = new IllegalStateException("Insufficient stock");
        ProceedingJoinPoint joinPoint = joinPointThatFails(Integer.MAX_VALUE, insufficientStock, null);

        IllegalStateException thrown = assertThrows(IllegalStateException.class,
                () -> aspect.retryOnConflict(joinPoint, annotation));

        assertEquals("Insufficient stock", thrown.getMessage());
        // Exactly one attempt: proving it failed fast rather than looping.
        org.mockito.Mockito.verify(joinPoint, org.mockito.Mockito.times(1)).proceed();
    }

    @Test
    @DisplayName("does NOT retry a constraint violation")
    void doesNotRetryConstraintViolation() throws Throwable {
        // A duplicate key is deterministic — replaying it just fails again.
        ProceedingJoinPoint joinPoint =
                joinPointThatFails(Integer.MAX_VALUE, new DataIntegrityViolationException("duplicate key"), null);

        assertThrows(DataIntegrityViolationException.class,
                () -> aspect.retryOnConflict(joinPoint, annotation));
        org.mockito.Mockito.verify(joinPoint, org.mockito.Mockito.times(1)).proceed();
    }

    @Test
    @DisplayName("gives up after maxAttempts and surfaces the original failure")
    void surfacesFailureAfterExhaustingAttempts() throws Throwable {
        ProceedingJoinPoint joinPoint = joinPointThatFails(
                Integer.MAX_VALUE, new CannotAcquireLockException("could not obtain lock"), null);

        Throwable thrown = assertThrows(CannotAcquireLockException.class,
                () -> aspect.retryOnConflict(joinPoint, annotation));

        assertInstanceOf(CannotAcquireLockException.class, thrown);
        // The caller must see the real cause, not a generic "retry failed" wrapper —
        // BillingService maps this onto its own 409 message.
        org.mockito.Mockito.verify(joinPoint, org.mockito.Mockito.times(annotation.maxAttempts())).proceed();
    }

    @Test
    @DisplayName("a self-referencing cause chain terminates instead of spinning")
    void handlesSelfReferencingCauseChain() throws Throwable {
        // Defensive: some drivers build exceptions whose getCause() returns themselves.
        // Walking that chain naively never terminates.
        SQLException selfReferencing = new SQLException("odd", "22000") {
            @Override
            public synchronized Throwable getCause() {
                return this;
            }
        };
        ProceedingJoinPoint joinPoint = joinPointThatFails(Integer.MAX_VALUE, selfReferencing, null);

        assertThrows(SQLException.class, () -> aspect.retryOnConflict(joinPoint, annotation));
    }
}
