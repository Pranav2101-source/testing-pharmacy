package com.checkup.pharmacy.config;

import com.checkup.pharmacy.tenant.SystemContext;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.cache.interceptor.KeyGenerator;
import org.springframework.security.core.context.SecurityContextHolder;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.StringJoiner;

/**
 * The default cache key generator: every key is prefixed with the caller's
 * pharmacy.
 *
 * <p><b>Why this is a default and not a convention.</b> Caching tenant-scoped data
 * under a key that omits the tenant is a cross-tenant data leak that
 * <i>bypasses every other control in the system</i> — Row-Level Security cannot
 * help, because a cache hit never reaches the database at all. The failure is also
 * invisible in single-tenant testing: it only appears once a second pharmacy uses
 * the same endpoint, and then it silently serves one pharmacy's data to another.
 *
 * <p>Spring's default generator builds keys from method arguments alone. So
 * {@code @Cacheable("dashboard") DashboardStats stats()} — a no-argument method
 * reading {@code TenantContext.pharmacyId()} internally — would produce ONE shared
 * key for every tenant on the platform. That is a single missing annotation
 * attribute away at all times, and it is not the kind of mistake that shows up in
 * review as obviously wrong.
 *
 * <p>Making tenant-prefixing the default inverts that: caching is safe unless
 * someone deliberately opts out. Methods that are genuinely platform-wide (the
 * PLATFORM_ADMIN analytics dashboard, for instance) declare an explicit
 * {@code key = "..."} on {@code @Cacheable}, which bypasses this generator by
 * design — an explicit, visible, reviewable choice rather than an omission.
 *
 * <p><b>Fails closed.</b> With no tenant and no {@link SystemContext} elevation it
 * throws rather than falling back to an un-prefixed key. A cache entry written
 * without a tenant would be readable by every tenant, so refusing to create one is
 * the only safe behaviour — and a loud failure in development is far cheaper than a
 * quiet leak in production.
 */
public class TenantAwareKeyGenerator implements KeyGenerator {

    /** Prefix for entries produced by background/system work, which spans tenants. */
    private static final String SYSTEM_SCOPE = "system";

    @Override
    public Object generate(Object target, Method method, Object... params) {
        StringJoiner key = new StringJoiner(":");
        key.add(scope());
        key.add(target.getClass().getSimpleName());
        key.add(method.getName());
        for (Object param : params) {
            key.add(param == null ? "null" : param.toString());
        }
        return key.toString();
    }

    private String scope() {
        // Elevated background work has no request principal by definition; it is
        // already an explicit, audited opt-out (see @CrossTenant), so give it its own
        // namespace rather than failing.
        if (SystemContext.isActive()) {
            return SYSTEM_SCOPE;
        }
        if (SecurityContextHolder.getContext().getAuthentication() == null) {
            throw new IllegalStateException(
                    "Refusing to build a cache key with no tenant in scope. An entry cached "
                    + "without a pharmacy prefix would be served to every tenant. Either call "
                    + "this from an authenticated request, wrap it in SystemContext, or declare "
                    + "an explicit key on @Cacheable if the data really is platform-wide.");
        }
        return TenantContext.pharmacyId();
    }

    /** Exposed for the test that asserts arguments participate in the key. */
    static String describeParams(Object... params) {
        return Arrays.toString(params);
    }
}
