package com.checkup.pharmacy;

import com.checkup.pharmacy.common.concurrency.RetryOnConflictAspect;
import com.checkup.pharmacy.jobs.ReservationCleanupJob;
import com.checkup.pharmacy.jobs.StockAlertJob;
import com.checkup.pharmacy.jobs.TenantSweeper;
import com.checkup.pharmacy.tenant.CrossTenantAspect;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.cache.CacheManager;
import org.springframework.context.ApplicationContext;
import org.springframework.core.Ordered;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.test.context.ActiveProfiles;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Boots the full application context to prove the bean graph actually wires up.
 *
 * <p>This is the cheapest test that would have caught the most expensive class of
 * mistake in this change set. Aspects, a replacement transaction manager, a cache
 * manager, a scheduler and a ShedLock provider were all added at once; every one
 * of them fails at <i>startup</i>, not at compile time, and a startup failure on
 * Railway is a full outage rather than a bad response. {@code mvn compile} says
 * nothing about any of it.
 *
 * <p>Runs against H2 with a stub Redis host. Nothing here executes an application
 * query or opens a Redis connection — Spring Data Redis connects lazily — so the
 * test needs no Docker and stays runnable in CI.
 */
@SpringBootTest
@ActiveProfiles("test")
@DisplayName("Application context: the bean graph wires up")
class ApplicationContextLoadTest {

    @Autowired
    private ApplicationContext context;

    @Test
    @DisplayName("context loads with aspects, scheduler, jobs and cache manager present")
    void contextLoads() {
        assertNotNull(context);

        // Aspects: silently absent if spring-boot-starter-aop were missing, which
        // would make @CrossTenant and @RetryOnConflict no-ops rather than errors —
        // the worst outcome, since both would appear to be working.
        assertNotNull(context.getBean(CrossTenantAspect.class));
        assertNotNull(context.getBean(RetryOnConflictAspect.class));

        assertNotNull(context.getBean(TaskScheduler.class));
        assertNotNull(context.getBean(CacheManager.class));

        assertNotNull(context.getBean(TenantSweeper.class));
        assertNotNull(context.getBean(StockAlertJob.class));
        assertNotNull(context.getBean(ReservationCleanupJob.class));
    }

    @Test
    @DisplayName("CrossTenant advice is ordered outside RetryOnConflict advice")
    void aspectOrderingIsCorrect() {
        int crossTenant = context.getBean(CrossTenantAspect.class).getClass()
                .getAnnotation(org.springframework.core.annotation.Order.class).value();
        int retry = context.getBean(RetryOnConflictAspect.class).getClass()
                .getAnnotation(org.springframework.core.annotation.Order.class).value();

        // Both must also sit outside the transaction interceptor (LOWEST_PRECEDENCE).
        // If retry ran INSIDE the transaction it would replay a transaction already
        // marked rollback-only and fail every attempt; if elevation ran inside, the
        // tenant GUC would already have been set to "no tenant" before it applied.
        assertTrue(crossTenant < retry,
                "@CrossTenant must wrap outside @RetryOnConflict so each retry attempt is still elevated");
        assertTrue(retry < Ordered.LOWEST_PRECEDENCE,
                "@RetryOnConflict must wrap outside the transaction interceptor");
    }
}
