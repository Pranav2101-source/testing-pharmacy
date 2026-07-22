package com.checkup.pharmacy.jobs;

import com.checkup.pharmacy.tenant.CrossTenant;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.function.Consumer;

/**
 * Executes one pharmacy's slice of a background job inside its own transaction.
 *
 * <p>Separate from {@link TenantSweeper} on purpose. The sweeper needs to catch a
 * per-tenant failure and carry on, but that {@code catch} must sit <b>outside</b>
 * the transaction boundary: catching inside an {@code @Transactional} method
 * makes the proxy see a normal return and <b>commit</b> the half-finished work
 * that just failed. Spring's proxying is also why this cannot simply be a private
 * method on the sweeper — a self-invocation would skip the proxy and run with no
 * transaction and no {@link CrossTenant} elevation at all.
 *
 * <p>{@code REQUIRES_NEW} guarantees a fresh transaction per tenant even if a
 * caller ever holds one open, so one tenant's rollback can never discard another's
 * committed work.
 */
@Component
public class TenantWorkRunner {

    @CrossTenant("Background job — acts for a tenant with no authenticated principal.")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void run(String pharmacyId, Consumer<String> work) {
        work.accept(pharmacyId);
    }
}
