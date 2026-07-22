package com.checkup.pharmacy.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

/**
 * Refuses to run with Row-Level Security enabled if the database role can bypass
 * it.
 *
 * <p><b>Why this is worth a startup check.</b> Postgres exempts superusers and
 * roles with {@code BYPASSRLS} from every policy — unconditionally, and with no
 * warning. Connect as such a role and the policies still exist, {@code \d} still
 * lists them, the migration still reports success, and not one of them is ever
 * enforced. Tenant isolation would look deployed while the application read across
 * tenants exactly as before.
 *
 * <p>This was found the hard way while verifying the policies against a real
 * Postgres 16: as the superuser {@code postgres}, a query scoped to pharmacy A
 * happily returned pharmacy B's rows. As a plain role, the same query returned
 * only A's. Security that silently does nothing is worse than none, because it
 * stops anyone looking.
 *
 * <p>Note {@code FORCE ROW LEVEL SECURITY} (which the migration sets) does not
 * help here: it makes a table's <i>owner</i> subject to policies, but has no
 * effect on superuser or {@code BYPASSRLS}.
 *
 * <p>Only active when {@code app.rls.enabled} is true — with RLS off there is
 * nothing to bypass, and the check would be noise.
 */
@Component
@ConditionalOnProperty(name = "app.rls.enabled", havingValue = "true")
public class RlsRoleValidator {

    private static final Logger log = LoggerFactory.getLogger(RlsRoleValidator.class);

    private final DataSource dataSource;
    private final boolean failOnBypass;

    public RlsRoleValidator(DataSource dataSource,
                            @Value("${app.rls.fail-on-bypass-role:true}") boolean failOnBypass) {
        this.dataSource = dataSource;
        this.failOnBypass = failOnBypass;
    }

    /**
     * Runs after startup rather than in a constructor so a transient database
     * blip does not prevent the context from building — but still before the
     * instance is considered healthy.
     */
    @EventListener(ApplicationReadyEvent.class)
    public void verifyRoleCannotBypassRls() {
        try (Connection connection = dataSource.getConnection();
             Statement statement = connection.createStatement();
             ResultSet rs = statement.executeQuery("""
                     SELECT current_user AS role_name,
                            rolsuper,
                            rolbypassrls
                     FROM pg_roles
                     WHERE rolname = current_user
                     """)) {

            if (!rs.next()) {
                log.warn("Could not determine the current database role; skipping the RLS bypass check.");
                return;
            }

            String roleName = rs.getString("role_name");
            boolean superuser = rs.getBoolean("rolsuper");
            boolean bypassRls = rs.getBoolean("rolbypassrls");

            if (!superuser && !bypassRls) {
                log.info("RLS enforcement confirmed: database role '{}' is subject to row-level security.", roleName);
                return;
            }

            String message = ("""
                    Row-Level Security is ENABLED but the database role '%s' BYPASSES it \
                    (superuser=%s, bypassrls=%s). Every tenant-isolation policy is silently \
                    inert and this service can read across tenants.

                    Fix: connect as a dedicated non-superuser role that owns no bypass, e.g.

                      CREATE ROLE app_user LOGIN PASSWORD '<secret>';
                      GRANT USAGE ON SCHEMA public TO app_user;
                      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

                    then point JDBC_DATABASE_URL/DB_USER at it. To start anyway (NOT recommended \
                    outside local development) set app.rls.fail-on-bypass-role=false.\
                    """).formatted(roleName, superuser, bypassRls);

            if (failOnBypass) {
                throw new IllegalStateException(message);
            }
            log.error(message);

        } catch (SQLException e) {
            // Do not take the service down for an unrelated database error; the
            // check is a guard, not a dependency.
            log.warn("RLS bypass check could not run: {}", e.getMessage());
        }
    }
}
