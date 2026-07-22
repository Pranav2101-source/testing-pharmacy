package com.checkup.pharmacy.jobs;

import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.tenant.CrossTenant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.function.Consumer;

/**
 * Shared plumbing for jobs that must visit every pharmacy.
 *
 * <p>Background work has no request principal, so there is no tenant for
 * Row-Level Security to scope to and every query would otherwise fail closed.
 * The sweep is therefore elevated via {@link CrossTenant}, while the actual
 * per-pharmacy queries still pass {@code pharmacyId} explicitly — elevation
 * removes the database's safety net, so application-level scoping has to stay
 * correct on its own.
 *
 * <p><b>One transaction per pharmacy, not one per sweep.</b> A single transaction
 * spanning every tenant would hold a database connection for the whole run
 * (against a pool of five), and one bad row would roll back work already done for
 * unrelated pharmacies.
 */
@Component
public class TenantSweeper {

    private static final Logger log = LoggerFactory.getLogger(TenantSweeper.class);

    private final PharmacyRepository pharmacyRepository;
    private final TenantWorkRunner runner;

    public TenantSweeper(PharmacyRepository pharmacyRepository, TenantWorkRunner runner) {
        this.pharmacyRepository = pharmacyRepository;
        this.runner = runner;
    }

    @CrossTenant("Background sweep — enumerates every tenant, so by definition cannot be tenant-scoped.")
    @Transactional(readOnly = true)
    public List<String> activePharmacyIds() {
        return pharmacyRepository.findActivePharmacyIds();
    }

    /**
     * Runs {@code work} for every active pharmacy, one transaction each, and
     * returns how many succeeded.
     *
     * <p>A per-tenant failure is logged and skipped rather than aborting the run:
     * a nightly expiry sweep that dies on pharmacy #3 must still deliver alerts to
     * pharmacy #4 onward. A job that silently stops halfway is worse than one that
     * never ran, because nobody notices the alerts that did not arrive.
     */
    public int sweep(String jobName, Consumer<String> work) {
        List<String> pharmacyIds = activePharmacyIds();
        int succeeded = 0;
        for (String pharmacyId : pharmacyIds) {
            try {
                // Through the proxy, so the transaction really is committed or
                // rolled back before this catch can see the outcome.
                runner.run(pharmacyId, work);
                succeeded++;
            } catch (RuntimeException e) {
                log.error("Job '{}' failed for pharmacy {} — continuing with the remaining tenants",
                        jobName, pharmacyId, e);
            }
        }
        log.info("Job '{}' finished: {}/{} pharmacies processed", jobName, succeeded, pharmacyIds.size());
        return succeeded;
    }
}
