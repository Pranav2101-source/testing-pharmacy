package com.checkup.pharmacy.jobs;

import com.checkup.pharmacy.modules.inventory.InventoryService;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Releases expired stock reservations across every pharmacy.
 *
 * <p>Reservations exist so two counters cannot sell the same units while one of
 * them is still building a bill. They carry a TTL, but nothing ever swept them:
 * expiry was only processed as a side effect of the <i>next</i> reservation
 * request for that same pharmacy. The failure mode is quiet and expensive — a
 * billing tab abandoned at shift change holds stock that the system then reports
 * as unavailable, so staff see "insufficient stock" for medicine sitting on the
 * shelf in front of them.
 *
 * <p>Every five minutes is deliberately far tighter than the alert jobs: this is
 * corrective work whose whole value is bounding how long stock can stay wrongly
 * held.
 */
@Component
public class ReservationCleanupJob {

    private static final Logger log = LoggerFactory.getLogger(ReservationCleanupJob.class);

    private final TenantSweeper sweeper;
    private final InventoryService inventoryService;

    public ReservationCleanupJob(TenantSweeper sweeper, InventoryService inventoryService) {
        this.sweeper = sweeper;
        this.inventoryService = inventoryService;
    }

    // lockAtMostFor is generous relative to the 5-minute period so a slow run is
    // never double-started by the next tick on another instance.
    @Scheduled(cron = "${app.jobs.reservation-cleanup-cron:0 */5 * * * *}")
    @SchedulerLock(name = "reservationCleanup", lockAtLeastFor = "PT30S", lockAtMostFor = "PT4M")
    public void run() {
        sweeper.sweep("reservationCleanup", pharmacyId -> {
            int released = inventoryService.releaseExpiredReservationsFor(pharmacyId);
            if (released > 0) {
                log.info("Released {} expired reservation(s) for pharmacy {}", released, pharmacyId);
            }
        });
    }
}
