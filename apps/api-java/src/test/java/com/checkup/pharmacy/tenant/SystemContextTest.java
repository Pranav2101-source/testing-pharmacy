package com.checkup.pharmacy.tenant;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link SystemContext} decides whether a transaction may read across tenants, so
 * its failure mode is a cross-tenant data leak. The property that matters is that
 * elevation is always given back — on the happy path, on an exception, and when
 * nested — because a thread that stays elevated is handed back to the servlet
 * container's pool and serves the next user's request with full database access.
 */
@DisplayName("SystemContext: cross-tenant elevation is always released")
class SystemContextTest {

    @AfterEach
    void assertNoLeakBetweenTests() {
        assertFalse(SystemContext.isActive(),
                "elevation leaked out of a test — in production this thread would serve "
                + "the next request with cross-tenant database access");
    }

    @Test
    @DisplayName("inactive by default")
    void inactiveByDefault() {
        assertFalse(SystemContext.isActive());
    }

    @Test
    @DisplayName("active inside the block, released after")
    void activeOnlyInsideBlock() {
        SystemContext.runAsSystem(() -> assertTrue(SystemContext.isActive()));
        assertFalse(SystemContext.isActive());
    }

    @Test
    @DisplayName("released even when the work throws")
    void releasedOnException() {
        assertThrows(IllegalStateException.class, () ->
                SystemContext.runAsSystem(() -> {
                    throw new IllegalStateException("boom");
                }));
        // Without the finally block this is where elevation would leak, and the leak
        // would be invisible until an unrelated request read another tenant's rows.
        assertFalse(SystemContext.isActive());
    }

    @Test
    @DisplayName("nesting restores the OUTER state, not plain 'off'")
    void nestingRestoresPreviousState() {
        SystemContext.runAsSystem(() -> {
            assertTrue(SystemContext.isActive());
            SystemContext.runAsSystem(() -> assertTrue(SystemContext.isActive()));
            // The inner block must not clear the outer elevation on exit. If it did,
            // the remainder of the outer method would silently run unelevated and
            // RLS would fail its queries closed — a job that half-works.
            assertTrue(SystemContext.isActive(), "inner block dropped the outer elevation");
        });
        assertFalse(SystemContext.isActive());
    }

    @Test
    @DisplayName("callAsSystem returns the value produced inside the block")
    void callAsSystemReturnsValue() {
        String result = SystemContext.callAsSystem(() -> SystemContext.isActive() ? "elevated" : "not");
        assertTrue("elevated".equals(result));
    }
}
