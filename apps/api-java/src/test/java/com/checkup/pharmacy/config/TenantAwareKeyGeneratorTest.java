package com.checkup.pharmacy.config;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.security.UserPrincipal;
import com.checkup.pharmacy.tenant.SystemContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.lang.reflect.Method;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The cache key generator decides whether one pharmacy can be served another
 * pharmacy's cached data.
 *
 * <p>This is a more dangerous surface than an un-scoped database query: a cache hit
 * never reaches Postgres, so Row-Level Security — the control that backstops every
 * other tenant-scoping mistake in this codebase — does not run. If keys collide
 * across tenants, nothing downstream will catch it.
 */
@DisplayName("Cache keys are always scoped to a tenant")
class TenantAwareKeyGeneratorTest {

    private final TenantAwareKeyGenerator generator = new TenantAwareKeyGenerator();

    /** Stand-in for a cached service method. */
    static class DashboardService {
        @SuppressWarnings("unused")
        public String stats() {
            return "";
        }

        @SuppressWarnings("unused")
        public String report(String from, String to) {
            return "";
        }
    }

    private static Method method(String name, Class<?>... args) throws NoSuchMethodException {
        return DashboardService.class.getMethod(name, args);
    }

    private void authenticateAs(String pharmacyId) {
        UserPrincipal principal = new UserPrincipal("user-1", pharmacyId, Role.OWNER, "u@example.com");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(principal, null, List.of()));
    }

    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    @DisplayName("two pharmacies calling the SAME no-argument method get different keys")
    void differentTenantsNeverShareAKey() throws Exception {
        Method stats = method("stats");
        DashboardService target = new DashboardService();

        authenticateAs("pharmacy-A");
        Object keyA = generator.generate(target, stats);

        SecurityContextHolder.clearContext();
        authenticateAs("pharmacy-B");
        Object keyB = generator.generate(target, stats);

        // This is the whole point. Spring's default generator keys on arguments
        // alone, so a no-arg method would produce ONE key shared by every tenant on
        // the platform — pharmacy B would be served pharmacy A's dashboard.
        assertNotEquals(keyA, keyB,
                "two tenants produced the same cache key for a no-argument method — "
                + "this is a cross-tenant data leak that RLS cannot catch");
        assertTrue(keyA.toString().startsWith("pharmacy-A:"), "key must be tenant-prefixed: " + keyA);
        assertTrue(keyB.toString().startsWith("pharmacy-B:"), "key must be tenant-prefixed: " + keyB);
    }

    @Test
    @DisplayName("the same pharmacy calling the same method twice gets the same key")
    void sameTenantHitsTheSameEntry() throws Exception {
        Method stats = method("stats");
        DashboardService target = new DashboardService();

        authenticateAs("pharmacy-A");
        // Stable keys are what makes it a cache rather than a memory leak.
        assertEquals(generator.generate(target, stats), generator.generate(target, stats));
    }

    @Test
    @DisplayName("arguments still participate, so different date ranges do not collide")
    void argumentsArePartOfTheKey() throws Exception {
        Method report = method("report", String.class, String.class);
        DashboardService target = new DashboardService();
        authenticateAs("pharmacy-A");

        Object january = generator.generate(target, report, "2026-01-01", "2026-01-31");
        Object february = generator.generate(target, report, "2026-02-01", "2026-02-28");

        assertNotEquals(january, february, "different arguments must not share a cache entry");
    }

    @Test
    @DisplayName("different methods on the same tenant do not collide")
    void methodNameIsPartOfTheKey() throws Exception {
        DashboardService target = new DashboardService();
        authenticateAs("pharmacy-A");

        assertNotEquals(
                generator.generate(target, method("stats")),
                generator.generate(target, method("report", String.class, String.class), "a", "b"));
    }

    @Test
    @DisplayName("FAILS CLOSED when there is no tenant at all")
    void refusesToGenerateWithoutATenant() throws Exception {
        Method stats = method("stats");
        DashboardService target = new DashboardService();

        // No authentication, no SystemContext. An entry written under this key would
        // carry no tenant prefix and therefore be readable by every tenant — throwing
        // is the only safe outcome.
        IllegalStateException thrown = assertThrows(IllegalStateException.class,
                () -> generator.generate(target, stats));

        assertTrue(thrown.getMessage().contains("no tenant"),
                "the failure should say why, not just blow up: " + thrown.getMessage());
    }

    @Test
    @DisplayName("background/system work gets its own namespace instead of failing")
    void systemContextGetsItsOwnScope() throws Exception {
        Method stats = method("stats");
        DashboardService target = new DashboardService();

        Object key = SystemContext.callAsSystem(() -> generator.generate(target, stats));

        // Scheduled sweeps legitimately have no request principal. They are already an
        // explicit, reviewed opt-out (@CrossTenant), so they get a separate namespace
        // rather than being blocked — but crucially NOT a tenant's namespace.
        assertTrue(key.toString().startsWith("system:"), "expected system scope, got: " + key);
    }
}
