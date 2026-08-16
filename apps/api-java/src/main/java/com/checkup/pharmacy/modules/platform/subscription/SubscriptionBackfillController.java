package com.checkup.pharmacy.modules.platform.subscription;

import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.platform.domain.Subscription;
import com.checkup.pharmacy.modules.platform.domain.SubscriptionRepository;
import com.checkup.pharmacy.modules.platform.domain.TenantSettings;
import com.checkup.pharmacy.modules.platform.domain.TenantSettingsRepository;
import com.checkup.pharmacy.common.enums.SubscriptionStatus;
import com.checkup.pharmacy.modules.platform.tenant.PlanPricing;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

/**
 * One-off repair for pharmacies created before signup provisioned a subscription.
 *
 * <p>PLATFORM_ADMIN, matching {@link SubscriptionController} — same package, same base
 * path. Without the annotation this inherited only {@code SecurityConfig}'s closing
 * {@code .anyRequest().authenticated()}, so ANY logged-in user (a cashier at any pharmacy)
 * could call it, and it iterates {@code findAll()} across every tenant on the platform and
 * writes rows for all of them. {@code UnscopedFinderCallGuardTest} did not catch the
 * unscoped finder because it only scans {@code *Service.java} under {@code modules/}.
 */
@RestController
@RequestMapping("/api/v1/platform/subscriptions")
@PreAuthorize("hasRole('PLATFORM_ADMIN')")
public class SubscriptionBackfillController {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionBackfillController.class);

    private final PharmacyRepository pharmacyRepository;
    private final SubscriptionRepository subscriptionRepository;
    private final TenantSettingsRepository tenantSettingsRepository;

    public SubscriptionBackfillController(PharmacyRepository pharmacyRepository,
                                          SubscriptionRepository subscriptionRepository,
                                          TenantSettingsRepository tenantSettingsRepository) {
        this.pharmacyRepository = pharmacyRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.tenantSettingsRepository = tenantSettingsRepository;
    }

    @PostMapping("/backfill")
    @Transactional
    public ResponseEntity<Map<String, Object>> backfillSubscriptions() {
        log.info("Starting subscription backfill process...");
        
        List<Pharmacy> allPharmacies = pharmacyRepository.findAll();
        int backfilledCount = 0;

        for (Pharmacy pharmacy : allPharmacies) {
            boolean hasSubscription = subscriptionRepository.findByPharmacyId(pharmacy.getId()).isPresent();
            if (!hasSubscription) {
                log.info("Backfilling subscription for pharmacy: {} (ID: {})", pharmacy.getName(), pharmacy.getId());
                
                // Create Subscription
                Instant validUntil = Instant.now().plus(30, ChronoUnit.DAYS);
                double amount = PlanPricing.amountFor(PlanPricing.DEFAULT_PLAN, PlanPricing.DEFAULT_BILLING_CYCLE);
                Subscription subscription = Subscription.create(pharmacy.getId(), PlanPricing.DEFAULT_PLAN, SubscriptionStatus.ACTIVE,
                        PlanPricing.DEFAULT_BILLING_CYCLE, amount, validUntil);
                subscriptionRepository.save(subscription);

                // Create TenantSettings if missing
                boolean hasSettings = tenantSettingsRepository.findByPharmacyId(pharmacy.getId()).isPresent();
                if (!hasSettings) {
                    TenantSettings settings = TenantSettings.create(pharmacy.getId(),
                            5, 5, 500, 1024,
                            true, true, false, false,
                            false, false, false, false);
                    tenantSettingsRepository.save(settings);
                }

                backfilledCount++;
            }
        }

        log.info("Subscription backfill process completed. Backfilled {} pharmacies.", backfilledCount);
        return ResponseEntity.ok(Map.of(
                "message", "Backfill completed successfully",
                "backfilledCount", backfilledCount
        ));
    }
}
