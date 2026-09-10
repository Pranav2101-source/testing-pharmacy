package com.checkup.pharmacy.jobs;

import com.checkup.pharmacy.modules.medicine.PackSizeReviewService;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Asks, once a night, whether enough pharmacists have disagreed with the dispensing engine
 * about the same medicine to be worth a catalogue admin's attention.
 *
 * <p><b>Nightly, not continuous.</b> A quorum needs signals from more than one pharmacy, which
 * accumulate over days — running this every ten minutes would spend a cross-tenant scan to
 * discover nothing has changed since breakfast. Nothing here is urgent either: the wrong pack
 * size is already being used, has been for weeks, and the outcome is a badge and a review task
 * rather than a fix. Three in the morning is when the catalogue is quietest.
 *
 * <p>Unlike the other jobs in this package this does NOT go through {@link TenantSweeper}.
 * Those visit each pharmacy in turn because their work is per-tenant; this one exists precisely
 * to look ACROSS tenants, and sweeping per pharmacy would make a quorum unreachable by
 * construction — every shop would see only its own votes. The elevation happens inside
 * {@link PackSizeReviewService#reviewQuorums()}, which carries the {@code @CrossTenant}
 * justification.
 *
 * <p>ShedLock as with every other job here: this writes to the shared catalogue, and two
 * replicas racing would raise two review tasks for one quarantine.
 */
@Component
@ConditionalOnProperty(name = "app.jobs.enabled", havingValue = "true", matchIfMissing = true)
public class PackSizeReviewJob {

    private static final Logger log = LoggerFactory.getLogger(PackSizeReviewJob.class);

    private final PackSizeReviewService reviewService;

    public PackSizeReviewJob(PackSizeReviewService reviewService) {
        this.reviewService = reviewService;
    }

    @Scheduled(cron = "${app.jobs.pack-size-review-cron:0 20 3 * * *}")
    @SchedulerLock(name = "packSizeReview", lockAtLeastFor = "PT30S", lockAtMostFor = "PT10M")
    public void sweep() {
        try {
            int quarantined = reviewService.reviewQuorums();
            if (quarantined > 0) {
                log.warn("Pack-size review: quarantined {} medicine{} pending catalogue review",
                        quarantined, quarantined == 1 ? "" : "s");
            }
        } catch (RuntimeException e) {
            // Swallowed rather than propagated: an unhandled exception out of a @Scheduled
            // method is logged by Spring and the schedule continues, but the stack trace
            // arrives without any of the context that makes it actionable. This is a
            // background quality sweep — it failing must never look like an outage, and it
            // must not stop tomorrow's run.
            log.error("Pack-size review sweep failed — will retry on the next schedule", e);
        }
    }
}
