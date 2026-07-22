package com.checkup.pharmacy.testsupport;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves the harness itself works before any module test relies on it.
 *
 * <p>If this fails, every other *IT is meaningless — so it is worth having as a
 * separate, obviously-named test rather than letting a broken container surface as
 * 40 confusing billing failures.
 */
class SchemaHarnessIT extends AbstractPostgresIT {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    @DisplayName("replaying the Prisma migrations produces the application's core tables")
    void migrationsProduceCoreTables() {
        List<String> tables = jdbcTemplate.queryForList(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public'", String.class);

        // A spot-check across several modules rather than an exhaustive list, which
        // would need editing on every new migration and would fail for no good reason.
        assertThat(tables)
                .contains("pharmacies", "users", "invoices", "invoice_items", "inventory")
                .hasSizeGreaterThan(30);
    }

    @Test
    @DisplayName("the app_user role exists and is NOT a superuser (RLS would be inert if it were)")
    void appUserRoleIsNotSuperuser() {
        Boolean isSuperuser = jdbcTemplate.queryForObject(
                "SELECT rolsuper FROM pg_roles WHERE rolname = 'app_user'", Boolean.class);

        assertThat(isSuperuser)
                .as("app_user must exist — the prescriptions migration GRANTs to it")
                .isNotNull()
                .isFalse();
    }
}
