package com.checkup.pharmacy.jobs;

import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.notification.NotificationService;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

/**
 * Nightly expiry and low-stock alerts.
 *
 * <p>The queries behind these alerts already existed — they powered the reports
 * screen. What was missing is that nothing ever <i>ran</i> them: a pharmacist only
 * learned a batch was about to expire if they thought to open the report. Expiry
 * write-off is the single largest avoidable loss in a pharmacy, and "the software
 * knew, but only if you asked it" is not a feature. This pushes the same
 * information into the notification bell without anyone having to look.
 *
 * <p>Runs at 07:00 in the pharmacy's local timezone (IST) rather than UTC, so the
 * alerts are waiting when the shop opens instead of appearing mid-afternoon.
 */
@Component
public class StockAlertJob {

    private static final Logger log = LoggerFactory.getLogger(StockAlertJob.class);

    /** Cap the medicines named in one notification; the full list lives in the report. */
    private static final int MAX_NAMED_ITEMS = 5;

    private final TenantSweeper sweeper;
    private final InventoryRepository inventoryRepository;
    private final NotificationService notificationService;
    private final int expiryWindowDays;

    public StockAlertJob(TenantSweeper sweeper,
                         InventoryRepository inventoryRepository,
                         NotificationService notificationService,
                         @Value("${app.jobs.expiry-window-days:60}") int expiryWindowDays) {
        this.sweeper = sweeper;
        this.inventoryRepository = inventoryRepository;
        this.notificationService = notificationService;
        this.expiryWindowDays = expiryWindowDays;
    }

    @Scheduled(cron = "${app.jobs.stock-alerts-cron:0 0 7 * * *}", zone = "Asia/Kolkata")
    @SchedulerLock(name = "stockAlerts", lockAtLeastFor = "PT1M", lockAtMostFor = "PT15M")
    public void run() {
        log.info("Starting nightly stock alert sweep (expiry window {} days)", expiryWindowDays);
        sweeper.sweep("stockAlerts", this::alertForPharmacy);
    }

    /**
     * Count first, then fetch only the handful of rows actually named in the message.
     *
     * <p>This previously loaded every matching batch just to read {@code .size()} and
     * name the first five — so a pharmacy with 4,000 expiring batches pulled 4,000
     * fully-hydrated entities (with their medicines fetch-joined) into memory to
     * produce one sentence. Multiply by every tenant in a single nightly sweep,
     * against a five-connection pool, and an alerting job becomes the heaviest thing
     * the database does all day.
     *
     * <p>Two cheap queries replace it: a COUNT for the number, and a LIMIT for the
     * names. The count stays exact — it is not the capped list's size.
     */
    private void alertForPharmacy(String pharmacyId) {
        Instant threshold = Instant.now().plus(expiryWindowDays, ChronoUnit.DAYS);
        Pageable sample = PageRequest.of(0, MAX_NAMED_ITEMS);

        long expiringCount = inventoryRepository.countExpiryAlerts(pharmacyId, threshold);
        if (expiringCount > 0) {
            List<Inventory> named = inventoryRepository.findExpiryAlerts(pharmacyId, threshold, sample);
            notificationService.inAppNotify(
                    pharmacyId,
                    expiringCount + " batch(es) expiring within " + expiryWindowDays + " days",
                    summarise(named, expiringCount) + " Review these in Reports → Expiry to return or discount them "
                    + "before they become a write-off.");
        }

        long lowStockCount = inventoryRepository.countLowStockAlerts(pharmacyId);
        if (lowStockCount > 0) {
            List<Inventory> named = inventoryRepository.findLowStockAlerts(pharmacyId, sample);
            notificationService.inAppNotify(
                    pharmacyId,
                    lowStockCount + " item(s) at or below minimum stock",
                    summarise(named, lowStockCount) + " Raise a purchase order before you run out.");
        }
    }

    /**
     * Names the sampled medicines and counts the rest. A notification listing two
     * hundred batches is not read by anyone; a notification naming five and saying
     * "and 195 more" gets someone to open the report.
     *
     * @param sample the few rows actually fetched, for names
     * @param total  the true total from the COUNT query — NOT {@code sample.size()},
     *               which is capped and would understate the problem
     */
    private String summarise(List<Inventory> sample, long total) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < sample.size(); i++) {
            Inventory inv = sample.get(i);
            if (i > 0) {
                sb.append(", ");
            }
            // Defensive: medicine is a lazy association and the catalog row could
            // have been removed underneath an inventory row.
            sb.append(inv.getMedicine() != null ? inv.getMedicine().getName() : "Unknown medicine");
            sb.append(" (batch ").append(inv.getBatchNumber()).append(")");
        }
        long remaining = total - sample.size();
        if (remaining > 0) {
            sb.append(" and ").append(remaining).append(" more");
        }
        return sb.append(".").toString();
    }
}
