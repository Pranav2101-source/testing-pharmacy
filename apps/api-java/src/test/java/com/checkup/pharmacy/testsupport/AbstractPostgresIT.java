package com.checkup.pharmacy.testsupport;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.security.UserPrincipal;
import org.junit.jupiter.api.AfterEach;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;

/**
 * Base class for integration tests that need a real database.
 *
 * <p>Boots the full Spring context against a Postgres whose schema is built by
 * replaying the actual Prisma migrations (see {@link PrismaSchemaLoader}).
 *
 * <p>WHY NOT TESTCONTAINERS
 * <p>It was the first choice and it does not work on this project's current Windows
 * dev machine: Docker Desktop 29.5.3 answers docker-java's handshake with an HTTP 400
 * and a stubbed Info body on every discovery strategy (npipe, explicit DOCKER_HOST,
 * pinned DOCKER_API_VERSION), while the docker CLI on the same box is healthy. Rather
 * than block all integration testing on that incompatibility, these tests use the
 * Postgres the repo's own compose file already defines:
 *
 * <pre>docker compose -f infra/docker/docker-compose.yml --profile test up -d postgres</pre>
 *
 * <p>{@code IT_DATABASE_URL} overrides the endpoint, so CI (whose Linux runners have
 * working Docker) can point these at a service container without code changes, and
 * Testcontainers can be reinstated later by overriding the same property.
 *
 * <p>ISOLATION
 * <p>Each run DROPs and RECREATEs a dedicated {@code pharmacy_it} database. Two
 * reasons: the suite starts from a known-empty schema every time regardless of what a
 * previous failed run left behind, and the {@code pharmacy} database on the same
 * cluster — which RLS_ROLLOUT.md uses for row-level-security work — is never touched.
 *
 * <p>ON RLS
 * <p>Tests connect as {@code postgres}, a superuser, and Postgres exempts superusers
 * from row-level security, so the policies these migrations install are inert here.
 * That is deliberate — an ordinary test should not have to set GUCs to see its own
 * rows — but it means a passing test here is NOT evidence that RLS works. RLS has its
 * own coverage.
 */
@SpringBootTest
@ActiveProfiles("it")
public abstract class AbstractPostgresIT {

    private static final String DEFAULT_HOST_URL = "jdbc:postgresql://localhost:5433/";
    private static final String IT_DATABASE = "pharmacy_it";
    private static final String USERNAME = "postgres";
    private static final String PASSWORD = "postgres";

    private static final String JDBC_URL = resolveAndPrepareDatabase();

    private static String resolveAndPrepareDatabase() {
        String baseUrl = System.getenv().getOrDefault("IT_DATABASE_URL", DEFAULT_HOST_URL);
        if (!baseUrl.endsWith("/")) {
            baseUrl = baseUrl + "/";
        }

        // Connect to the always-present `postgres` database to issue the DROP/CREATE:
        // a database cannot be dropped while you are connected to it.
        try (Connection admin = connect(baseUrl + "postgres")) {
            try (Statement statement = admin.createStatement()) {
                // FORCE terminates leftover connections from a previous crashed run,
                // which would otherwise make the DROP hang indefinitely.
                statement.execute("DROP DATABASE IF EXISTS " + IT_DATABASE + " WITH (FORCE)");
                statement.execute("CREATE DATABASE " + IT_DATABASE);
            }
        } catch (SQLException e) {
            throw new IllegalStateException(
                    "Could not reach the integration-test Postgres at " + baseUrl + ".\n"
                            + "Start it with:\n"
                            + "  docker compose -f infra/docker/docker-compose.yml --profile test up -d postgres\n"
                            + "or set IT_DATABASE_URL to another Postgres.\n"
                            + "Underlying error: " + e.getMessage(), e);
        }

        String itUrl = baseUrl + IT_DATABASE;
        try (Connection connection = connect(itUrl)) {
            PrismaSchemaLoader.apply(connection);
        } catch (SQLException e) {
            throw new IllegalStateException("Could not build the schema in " + itUrl, e);
        }
        return itUrl;
    }

    private static Connection connect(String url) throws SQLException {
        return DriverManager.getConnection(url, USERNAME, PASSWORD);
    }

    @DynamicPropertySource
    static void datasourceProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> JDBC_URL);
        registry.add("spring.datasource.username", () -> USERNAME);
        registry.add("spring.datasource.password", () -> PASSWORD);
    }

    /**
     * Security context is a ThreadLocal and JUnit reuses threads across tests, so a
     * principal left behind here would silently authenticate the *next* test — which
     * shows up as a test that passes alone and fails in a suite.
     */
    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    /**
     * Puts a principal in the SecurityContext so {@code TenantContext.pharmacyId()}
     * resolves. The {@code ROLE_} prefix mirrors JwtAuthenticationFilter:102 — without
     * it {@code @PreAuthorize("hasRole('OWNER')")} would not match.
     */
    protected static void authenticateAs(String userId, String pharmacyId, Role role) {
        UserPrincipal principal = new UserPrincipal(userId, pharmacyId, role, userId + "@test.local");
        var authentication = new UsernamePasswordAuthenticationToken(
                principal, null, List.of(new SimpleGrantedAuthority("ROLE_" + role.name())));
        SecurityContextHolder.getContext().setAuthentication(authentication);
    }
}
