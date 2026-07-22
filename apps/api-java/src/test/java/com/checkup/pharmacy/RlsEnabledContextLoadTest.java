package com.checkup.pharmacy;

import com.checkup.pharmacy.tenant.RlsTenantTransactionManager;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.junit.jupiter.SpringExtension;
import org.springframework.transaction.PlatformTransactionManager;

import static org.junit.jupiter.api.Assertions.assertInstanceOf;

/**
 * Boots the context with {@code app.rls.enabled=true}.
 *
 * <p>Flipping that flag swaps out the application's {@link PlatformTransactionManager}
 * — the bean every write in the system depends on. If that override is misconfigured
 * the application does not start, and the moment anyone would discover it is the
 * production cutover, mid-migration, with the database already carrying live RLS
 * policies. Verifying the swap here costs seconds.
 *
 * <p>What this does NOT verify: that the tenant GUC is actually applied, or that
 * the policies isolate correctly. Both need a real Postgres — H2 has no
 * {@code set_config} and no row-level security. That verification belongs on
 * staging against the real migration, and is called out in the rollout steps in
 * {@code RlsConfig}.
 */
@SpringBootTest(properties = "app.rls.enabled=true")
@ActiveProfiles("test")
@ExtendWith(SpringExtension.class)
@DisplayName("Application context: RLS transaction manager swaps in when enabled")
class RlsEnabledContextLoadTest {

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Test
    @DisplayName("the RLS-aware transaction manager replaces the default")
    void rlsTransactionManagerIsPrimary() {
        // If this resolves to a plain JpaTransactionManager, the flag is silently
        // doing nothing — the failure mode that leaves you believing tenant
        // isolation is enforced when it is not.
        assertInstanceOf(RlsTenantTransactionManager.class, transactionManager,
                "app.rls.enabled=true must install the RLS-aware transaction manager");
    }
}
