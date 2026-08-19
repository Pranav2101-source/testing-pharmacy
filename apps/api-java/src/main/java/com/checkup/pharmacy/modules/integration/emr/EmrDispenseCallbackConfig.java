package com.checkup.pharmacy.modules.integration.emr;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

/**
 * The pool the dispense callback runs on.
 *
 * <p>Named, and referenced by name from the listener. An unqualified {@code @Async} uses
 * Spring's default executor, which is UNBOUNDED — a slow EMR would grow threads until the
 * process died, taking the till with it. Every {@code @Async} in this codebase names its
 * executor for that reason.
 *
 * <p>The bounds are deliberately small. This work is never urgent: the prescription is
 * already billed and the status column means a dropped attempt is recovered by the sweeper
 * rather than lost. Small pool, small queue, and a rejection policy that gives up rather
 * than pushing the work onto the caller — because the caller is the thread that just
 * served a customer.
 */
@Configuration
@EnableAsync
public class EmrDispenseCallbackConfig {

    public static final String EXECUTOR = "emrDispenseCallbackExecutor";

    @Bean(EXECUTOR)
    public Executor emrDispenseCallbackExecutor() {
        var executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("emr-dispense-");
        // ABORT, not CallerRuns. CallerRuns would hand a stalled HTTP call to whichever
        // thread committed the sale, so a slow clinic would slow down billing — the exact
        // coupling this whole design exists to prevent. A rejected task leaves the
        // prescription PENDING, which the sweeper picks up.
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(20);
        executor.initialize();
        return executor;
    }
}
