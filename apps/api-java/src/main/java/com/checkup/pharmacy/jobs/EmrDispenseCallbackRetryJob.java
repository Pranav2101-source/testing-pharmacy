package com.checkup.pharmacy.jobs;

import com.checkup.pharmacy.modules.integration.emr.EmrDispenseCallbackRetryService;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Works off the dispense-callback backlog.
 *
 * <p>Without this the status columns are paperwork. A callback can fail for reasons that
 * clear on their own — an EMR restart, a certificate renewal, a network blip — and until
 * something retries, a clinic whose endpoint was down for ten minutes has charts that are
 * permanently wrong. The same applies to a prescription left PENDING because the app was
 * restarted between the sale committing and the delivery running: nothing else would ever
 * pick it up.
 *
 * <p>Every two minutes rather than continuously: the first backoff step is a minute, so a
 * shorter tick would mostly find nothing, and a longer one would make the fastest recovery
 * slower than the failure that caused it.
 */
@Component
@ConditionalOnProperty(name = "app.jobs.enabled", havingValue = "true", matchIfMissing = true)
public class EmrDispenseCallbackRetryJob {

    private static final Logger log = LoggerFactory.getLogger(EmrDispenseCallbackRetryJob.class);

    private final EmrDispenseCallbackRetryService retryService;

    public EmrDispenseCallbackRetryJob(EmrDispenseCallbackRetryService retryService) {
        this.retryService = retryService;
    }

    /**
     * {@code lockAtMostFor} is generous relative to the tick because a sweep is bounded by
     * HTTP calls to servers that may be timing out — 25 deliveries at an 8-second read
     * timeout is a slow tick, not a stuck one, and a lock that expired underneath it would
     * let a second instance start the same work.
     */
    @Scheduled(cron = "${app.jobs.emr-dispense-retry-cron:0 */2 * * * *}")
    @SchedulerLock(name = "emrDispenseCallbackRetry", lockAtLeastFor = "PT30S", lockAtMostFor = "PT10M")
    public void sweep() {
        try {
            int delivered = retryService.sweep();
            if (delivered > 0) {
                log.info("EMR dispense callback sweep delivered {} prescription(s)", delivered);
            }
        } catch (RuntimeException e) {
            // A scheduled method that throws is not retried and, depending on the scheduler,
            // can stop the whole task. This work is entirely recoverable on the next tick, so
            // log and let it come round again.
            log.error("EMR dispense callback sweep failed", e);
        }
    }
}
