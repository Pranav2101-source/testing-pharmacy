package com.checkup.pharmacy.config;

import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.provider.redis.spring.RedisLockProvider;
import net.javacrumbs.shedlock.spring.annotation.EnableSchedulerLock;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

/**
 * Enables scheduled and asynchronous work.
 *
 * <p>Until now the application had no background execution at all: expiry and
 * low-stock alerts were only ever computed when someone happened to open a
 * report, and expired stock reservations were released as a side effect of the
 * next reservation request — so a batch reserved by an abandoned billing session
 * stayed locked until some other sale happened to touch it. Anything that should
 * happen "every night" or "every five minutes" simply did not happen.
 *
 * <p><b>ShedLock.</b> This service may run as more than one replica, and
 * {@code @Scheduled} is per-JVM: every replica would fire the same nightly sweep,
 * writing duplicate notifications and, worse, duplicate stock adjustments. Each
 * job is wrapped in a Redis lock so exactly one instance runs it. The
 * {@code lockAtMostFor} on each job is the crash safety valve — if the holder
 * dies mid-run, the lock expires and the next schedule proceeds rather than the
 * job wedging forever.
 *
 * <p><b>Bounded pools.</b> Both executors are explicitly bounded with a
 * CallerRunsPolicy. An unbounded queue in front of a 5-connection database pool
 * is a memory leak wearing a trampoline: work piles up faster than it can drain
 * and the heap absorbs it. CallerRunsPolicy instead applies backpressure to the
 * submitter, which slows intake to what the database can actually sustain.
 */
@Configuration
@EnableScheduling
@EnableAsync
@EnableSchedulerLock(defaultLockAtMostFor = "PT10M")
@ConditionalOnProperty(name = "app.jobs.enabled", havingValue = "true", matchIfMissing = true)
public class SchedulingConfig {

    /**
     * Redis-backed job locks. Reuses the connection factory already configured
     * for rate limiting, so no new infrastructure is required.
     *
     * <p>Note this differs from {@code RateLimitService}, which fails OPEN when
     * Redis is down. Failing open here would mean "run the job on every replica",
     * i.e. duplicate writes — so if Redis is unavailable the lock cannot be taken
     * and the job is skipped until the next tick. Skipping a nightly sweep is
     * recoverable; double-applying stock adjustments is not.
     */
    @Bean
    public LockProvider lockProvider(RedisConnectionFactory connectionFactory) {
        return new RedisLockProvider(connectionFactory, "checkup-pharmacy");
    }

    /** Runs the @Scheduled jobs themselves. Small — these are sweeps, not request work. */
    @Bean
    public ThreadPoolTaskScheduler taskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(2);
        scheduler.setThreadNamePrefix("sched-");
        scheduler.setWaitForTasksToCompleteOnShutdown(true);
        // Give an in-flight sweep a chance to finish on SIGTERM instead of being
        // killed mid-transaction during a redeploy.
        scheduler.setAwaitTerminationSeconds(30);
        scheduler.setRemoveOnCancelPolicy(true);
        return scheduler;
    }

    /** Backs @Async — currently fire-and-forget notification writes. */
    @Bean("applicationTaskExecutor")
    public Executor applicationTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        // Deliberately shallow. Deeper queues just hide the fact that the database
        // pool is the real bottleneck, converting a fast failure into a slow one.
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("async-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        return executor;
    }
}
