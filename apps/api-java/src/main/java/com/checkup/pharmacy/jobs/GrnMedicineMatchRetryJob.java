package com.checkup.pharmacy.jobs;

import com.checkup.pharmacy.modules.medicine.GrnMedicineMatchService;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Works off the backlog of pharmacy-local medicines the async matcher missed —
 * a crash, a saturated pool, or a restart between the GRN commit and the
 * listener running. Mirrors {@code EmrDispenseCallbackRetryJob}: without this,
 * a dropped attempt would leave a medicine PENDING forever, since nothing else
 * would ever pick it up.
 *
 * <p>Every ten minutes, not continuously: this is a low-urgency backstop for an
 * already-successful GRN receipt, not a user-facing wait.
 */
@Component
@ConditionalOnProperty(name = "app.jobs.enabled", havingValue = "true", matchIfMissing = true)
public class GrnMedicineMatchRetryJob {

    private static final Logger log = LoggerFactory.getLogger(GrnMedicineMatchRetryJob.class);

    private final TenantSweeper tenantSweeper;
    private final GrnMedicineMatchService matchService;

    public GrnMedicineMatchRetryJob(TenantSweeper tenantSweeper, GrnMedicineMatchService matchService) {
        this.tenantSweeper = tenantSweeper;
        this.matchService = matchService;
    }

    @Scheduled(cron = "${app.jobs.grn-medicine-match-retry-cron:0 */10 * * * *}")
    @SchedulerLock(name = "grnMedicineMatchRetry", lockAtLeastFor = "PT30S", lockAtMostFor = "PT10M")
    public void sweep() {
        int processed = tenantSweeper.sweep("grnMedicineMatchRetry", matchService::retryStaleForPharmacy);
        if (processed > 0) {
            log.info("GRN medicine match retry sweep visited {} pharmac{}", processed, processed == 1 ? "y" : "ies");
        }
    }
}
