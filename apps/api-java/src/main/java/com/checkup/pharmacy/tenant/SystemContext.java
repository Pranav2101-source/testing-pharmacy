package com.checkup.pharmacy.tenant;

import java.util.function.Supplier;

/**
 * Explicit, opt-in escape hatch for work that legitimately spans tenants.
 *
 * <p>With Row-Level Security enabled ({@code app.rls.enabled}), every transaction
 * runs scoped to the authenticated caller's pharmacy and the database returns
 * nothing outside it. A handful of code paths genuinely have no tenant yet, or
 * genuinely need to cross tenants:
 *
 * <ul>
 *   <li><b>Authentication</b> — login/register/refresh look a user up <i>by email
 *       or token subject</i>, before any tenant is known. Chicken-and-egg: the
 *       tenant comes <i>from</i> the row being fetched.</li>
 *   <li><b>The JWT filter</b> — re-reads the user on every request to check
 *       {@code tokenVersion}, and runs <i>before</i> the SecurityContext is
 *       populated. Without a bypass here, RLS would fail this lookup closed and
 *       every authenticated request in the system would 401.</li>
 *   <li><b>Background jobs</b> — scheduled work sweeps all pharmacies and has no
 *       request principal at all.</li>
 * </ul>
 *
 * <p>This is deliberately an <b>explicit</b> marker rather than an implicit
 * "no principal means system" rule. Implicit escalation is the dangerous design:
 * it would silently grant full cross-tenant database access to any endpoint that
 * was ever accidentally left unauthenticated. Here, the default for an
 * unauthenticated transaction is to fail closed, and crossing tenants requires a
 * visible, greppable call site.
 *
 * <p>Scope it as tightly as the work allows — wrap the single query, not an
 * entire service method.
 */
public final class SystemContext {

    private static final ThreadLocal<Boolean> ACTIVE = ThreadLocal.withInitial(() -> Boolean.FALSE);

    private SystemContext() {
    }

    /** True when the current thread is inside {@link #runAsSystem}/{@link #callAsSystem}. */
    public static boolean isActive() {
        return ACTIVE.get();
    }

    /** Runs {@code work} with cross-tenant database access. */
    public static void runAsSystem(Runnable work) {
        callAsSystem(() -> {
            work.run();
            return null;
        });
    }

    /** Runs {@code work} with cross-tenant database access and returns its result. */
    public static <T> T callAsSystem(Supplier<T> work) {
        // Restore the PREVIOUS value rather than clearing, so nesting works and an
        // inner block can't silently drop an outer one's elevation on exit.
        boolean previous = ACTIVE.get();
        ACTIVE.set(Boolean.TRUE);
        try {
            return work.get();
        } finally {
            ACTIVE.set(previous);
        }
    }

    /**
     * {@link #callAsSystem} for work that may throw anything, including
     * {@link Throwable}. Exists for {@link CrossTenantAspect}, whose
     * {@code joinPoint.proceed()} is declared {@code throws Throwable} and so
     * cannot be expressed as a {@link Callable} (which only permits
     * {@link Exception}).
     */
    public static <T> T callAsSystemThrowing(ThrowingSupplier<T> work) throws Throwable {
        boolean previous = ACTIVE.get();
        ACTIVE.set(Boolean.TRUE);
        try {
            return work.get();
        } finally {
            ACTIVE.set(previous);
        }
    }

    /** A {@link Supplier} that is allowed to throw {@link Throwable}. */
    @FunctionalInterface
    public interface ThrowingSupplier<T> {
        T get() throws Throwable;
    }
}
