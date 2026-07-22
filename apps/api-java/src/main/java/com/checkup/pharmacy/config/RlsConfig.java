package com.checkup.pharmacy.config;

import com.checkup.pharmacy.tenant.RlsTenantTransactionManager;
import jakarta.persistence.EntityManagerFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Wires database-enforced tenant isolation, gated on {@code app.rls.enabled}.
 *
 * <p><b>Off by default, deliberately.</b> Row-Level Security is only as good as
 * the policies actually present in the database. Enabling it in the application
 * before the migration has been applied would be harmless (the GUCs would simply
 * be set and ignored), but the reverse — policies live while some code path still
 * fails to set the GUC — fails closed and looks like data loss to a pharmacist
 * mid-sale. So the rollout is ordered and reversible:
 *
 * <ol>
 *   <li>Apply {@code 20260719000001_row_level_security} to a <i>staging</i>
 *       database.</li>
 *   <li>Set {@code RLS_ENABLED=true} there and exercise billing, inventory,
 *       purchases, reports, and the platform-admin console.</li>
 *   <li>Confirm cross-tenant reads return empty — see
 *       {@code TenantIsolationGuardTest} for the invariant this enforces
 *       statically.</li>
 *   <li>Only then apply the migration to production and flip the flag.</li>
 * </ol>
 *
 * <p>Rollback is {@code RLS_ENABLED=false} (instant, no deploy if it is an env
 * var) or {@code down.sql} next to the migration.
 *
 * <p>When disabled, no bean is registered here and Spring Boot's stock
 * {@code JpaTransactionManager} is used — behaviour identical to before RLS.
 */
@Configuration
@ConditionalOnProperty(name = "app.rls.enabled", havingValue = "true")
public class RlsConfig {

    private static final Logger log = LoggerFactory.getLogger(RlsConfig.class);

    @Bean
    @Primary
    public PlatformTransactionManager transactionManager(EntityManagerFactory emf) {
        log.info("Row-Level Security ENABLED — every transaction will be stamped with "
                 + "app.pharmacy_id. Ensure migration 20260719000001_row_level_security "
                 + "has been applied to this database, or the policies do not exist and "
                 + "isolation is still convention-only.");
        return new RlsTenantTransactionManager(emf);
    }
}
