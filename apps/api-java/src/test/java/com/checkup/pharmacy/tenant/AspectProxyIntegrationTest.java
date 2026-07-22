package com.checkup.pharmacy.tenant;

import com.checkup.pharmacy.common.concurrency.RetryOnConflict;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.stereotype.Component;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Exercises {@link CrossTenant} and {@link RetryOnConflict} through real Spring
 * proxies.
 *
 * <p><b>This test exists because of a bug the unit tests could not see.</b> Both
 * aspects originally bound the annotation as an advice parameter
 * ({@code @Around("@annotation(crossTenant)")}). That compiles, passes every unit
 * test that calls the advice method directly, and then fails at runtime the moment
 * the advised bean carries a second proxy — which every {@code @Transactional}
 * service does:
 *
 * <pre>
 *   java.lang.IllegalStateException: Required to bind 2 arguments, but only bound 1
 *   (JoinPointMatch was NOT bound in invocation)
 * </pre>
 *
 * <p>The symptom was total: user registration returned 500. Nothing short of
 * invoking an annotated method through an actual proxy would have caught it, so
 * that is what this does.
 */
@SpringBootTest
@ActiveProfiles("test")
@DisplayName("Aspects: annotations work through real Spring proxies")
class AspectProxyIntegrationTest {

    @Autowired
    private AspectProbe probe;

    @Test
    @DisplayName("@CrossTenant elevates when invoked through the proxy")
    void crossTenantElevatesThroughProxy() {
        assertFalse(SystemContext.isActive(), "precondition: not elevated before the call");

        boolean elevatedInside = probe.crossTenantMethod();

        assertTrue(elevatedInside,
                "@CrossTenant did not elevate — the advice is not being applied through the proxy");
        assertFalse(SystemContext.isActive(), "elevation must be released after the call");
    }

    @Test
    @DisplayName("@CrossTenant applies even when combined with @Transactional")
    void crossTenantWorksAlongsideTransactional() {
        // The exact combination that broke: two advisors on one bean. @Transactional
        // is present so the proxy carries transaction advice as well as ours.
        assertTrue(probe.crossTenantTransactionalMethod(),
                "@CrossTenant must still apply when the method is also @Transactional");
    }

    @Test
    @DisplayName("@RetryOnConflict replays through the proxy and resolves its attributes")
    void retryOnConflictAppliesThroughProxy() {
        probe.reset();

        String result = probe.retryableMethod();

        assertEquals("succeeded", result);
        // 3 = two induced failures plus the successful attempt. Proves both that the
        // advice fired and that maxAttempts was read off the annotation rather than
        // silently falling back to a single attempt.
        assertEquals(3, probe.attempts(), "expected two retries before success");
    }

    @TestConfiguration
    static class Config {
        @Bean
        AspectProbe aspectProbe() {
            return new AspectProbe();
        }
    }

    /** A bean whose methods carry the annotations, so the proxy is real. */
    @Component
    static class AspectProbe {

        private final AtomicInteger attempts = new AtomicInteger();

        void reset() {
            attempts.set(0);
        }

        int attempts() {
            return attempts.get();
        }

        @CrossTenant("Test probe — verifies the aspect applies through a proxy.")
        public boolean crossTenantMethod() {
            return SystemContext.isActive();
        }

        @CrossTenant("Test probe — verifies the aspect applies alongside transaction advice.")
        @Transactional(readOnly = true)
        public boolean crossTenantTransactionalMethod() {
            return SystemContext.isActive();
        }

        @RetryOnConflict(baseBackoffMillis = 1)
        public String retryableMethod() {
            if (attempts.incrementAndGet() < 3) {
                throw new ConcurrencyFailureException("simulated write race");
            }
            return "succeeded";
        }
    }
}
