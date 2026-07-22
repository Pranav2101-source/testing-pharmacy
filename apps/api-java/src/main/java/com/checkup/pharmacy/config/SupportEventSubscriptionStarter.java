package com.checkup.pharmacy.config;

import com.checkup.pharmacy.modules.support.SupportEventBus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.stereotype.Component;

import jakarta.annotation.PreDestroy;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Starts the support event subscription after the application is already serving
 * traffic, and keeps retrying until Redis is reachable.
 *
 * <p>Separate from {@link SupportEventsConfig} on purpose: the container bean must
 * be fully constructed before anything tries to start it, and the retry needs a
 * {@link TaskScheduler}. Doing both inside the {@code @Bean} method would mean a
 * configuration class holding mutable state and reaching into its own bean, which
 * is exactly the kind of ordering the container makes no promises about.
 *
 * <p>The result is that Redis availability affects only whether support events
 * cross instance boundaries — never whether the service starts, and never whether
 * a pharmacy can bill.
 */
@Component
public class SupportEventSubscriptionStarter {

    private static final Logger log = LoggerFactory.getLogger(SupportEventSubscriptionStarter.class);

    private final RedisMessageListenerContainer container;

    /**
     * Its own single daemon thread rather than the shared {@code TaskScheduler}.
     *
     * <p>That scheduler bean only exists when {@code app.jobs.enabled} is true, so
     * injecting it silently coupled cross-instance support events to the background
     * jobs feature flag — with jobs disabled, this bean failed to construct and took
     * the whole application down with it. Found by booting with
     * {@code JOBS_ENABLED=false}.
     *
     * <p>Daemon, so a pending retry can never hold the JVM open during shutdown.
     */
    private final ScheduledExecutorService retryExecutor =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "support-events-subscribe-retry");
                t.setDaemon(true);
                return t;
            });

    public SupportEventSubscriptionStarter(RedisMessageListenerContainer container) {
        this.container = container;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onApplicationReady() {
        attemptStart();
    }

    @PreDestroy
    void shutdown() {
        retryExecutor.shutdownNow();
    }

    private void attemptStart() {
        if (container.isRunning()) {
            return;
        }
        try {
            container.start();
            log.info("Subscribed to Redis channel '{}' — support events now fan out across instances",
                    SupportEventBus.CHANNEL);
        } catch (Exception e) {
            // Not an error: this is the documented degraded mode. Live updates still
            // reach clients connected to this instance via local fan-out.
            log.warn("Redis unavailable — support events stay local to this instance. "
                     + "Retrying in {}s. ({})",
                    SupportEventsConfig.RETRY_INTERVAL.toSeconds(), e.toString());
            retryExecutor.schedule(this::attemptStart,
                    SupportEventsConfig.RETRY_INTERVAL.toSeconds(), TimeUnit.SECONDS);
        }
    }
}
