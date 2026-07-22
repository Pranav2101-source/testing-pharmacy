package com.checkup.pharmacy.tenant;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.security.UserPrincipal;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import org.hibernate.Session;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.orm.jpa.EntityManagerHolder;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.sql.PreparedStatement;

/**
 * Stamps every transaction with the caller's tenant so Postgres Row-Level
 * Security can enforce isolation in the database (see the
 * {@code 20260719000001_row_level_security} migration).
 *
 * <p>Immediately after the transaction begins, this sets two transaction-local
 * GUCs on the connection:
 *
 * <pre>
 *   app.pharmacy_id  -- the caller's tenant, or '' when unknown
 *   app.bypass_rls   -- 'on' for platform admins and {@link SystemContext} work
 * </pre>
 *
 * <p><b>Why {@code set_config(..., is_local => true)} and not {@code SET}.</b>
 * The {@code is_local} flag scopes the value to the current transaction, so
 * Postgres resets it on commit or rollback. That is what makes this correct
 * behind Supabase's transaction-mode pooler: a transaction is pinned to a single
 * backend for its lifetime, but the connection is handed to a different tenant's
 * transaction afterwards. A session-level {@code SET} would persist onto that
 * pooled connection and leak one tenant's scope into the next request — the
 * exact failure this class exists to prevent.
 *
 * <p><b>Why this hooks doBegin rather than a DataSource wrapper.</b> Hikari hands
 * out connections independently of transaction boundaries, so a
 * {@code getConnection()} hook cannot know which tenant a connection is about to
 * serve. {@code doBegin} is the one point where "a transaction is starting" and
 * "here is its connection" are both true.
 *
 * <p><b>Fail-closed.</b> With no principal and no {@link SystemContext}
 * elevation, {@code app.pharmacy_id} is set to the empty string, which matches no
 * row's {@code pharmacyId}. Losing tenant context therefore yields an empty
 * result set, never another pharmacy's data.
 *
 * <p>When {@code app.rls.enabled} is false this class is not registered at all
 * and the stock {@link JpaTransactionManager} is used, so behaviour is byte-for-
 * byte what it was before RLS existed. That is the intended posture until the
 * policies have been verified against a real database.
 */
public class RlsTenantTransactionManager extends JpaTransactionManager {

    private static final Logger log = LoggerFactory.getLogger(RlsTenantTransactionManager.class);

    /** Matches no pharmacyId, so an un-scoped transaction sees nothing. */
    private static final String NO_TENANT = "";

    public RlsTenantTransactionManager(EntityManagerFactory emf) {
        super(emf);
    }

    @Override
    protected void doBegin(Object transaction, TransactionDefinition definition) {
        super.doBegin(transaction, definition);
        try {
            applyTenantScope();
        } catch (RuntimeException e) {
            // Never let a scoping failure fall through as a half-configured
            // transaction — that would run the caller's queries with NO tenant
            // GUC set. RLS would fail those closed (empty results), which is safe
            // but baffling to debug; an explicit error is far easier to action.
            throw new IllegalStateException(
                    "Failed to apply RLS tenant scope to the transaction. "
                    + "Refusing to continue unscoped.", e);
        }
    }

    private void applyTenantScope() {
        EntityManagerFactory emf = getEntityManagerFactory();
        if (emf == null) {
            return;
        }
        EntityManagerHolder holder =
                (EntityManagerHolder) TransactionSynchronizationManager.getResource(emf);
        if (holder == null) {
            return;
        }
        EntityManager em = holder.getEntityManager();

        UserPrincipal principal = currentPrincipalOrNull();
        // A platform admin's whole job is spanning tenants, and every /platform/*
        // route is already guarded by role-based access control at the web layer.
        boolean bypass = SystemContext.isActive()
                || (principal != null && principal.role() == Role.PLATFORM_ADMIN);
        String pharmacyId = principal != null && principal.pharmacyId() != null
                ? principal.pharmacyId()
                : NO_TENANT;

        em.unwrap(Session.class).doWork(connection -> {
            // Parameterised, not string-concatenated: pharmacyId originates in a
            // JWT claim, and set_config's value argument is a plain string that
            // would otherwise be an injection sink.
            try (PreparedStatement ps = connection.prepareStatement(
                    "SELECT set_config('app.pharmacy_id', ?, true), set_config('app.bypass_rls', ?, true)")) {
                ps.setString(1, pharmacyId);
                ps.setString(2, bypass ? "on" : "off");
                ps.execute();
            }
        });

        if (bypass && log.isDebugEnabled()) {
            log.debug("Transaction elevated to cross-tenant access (system={}, role={})",
                    SystemContext.isActive(), principal == null ? null : principal.role());
        }
    }

    private UserPrincipal currentPrincipalOrNull() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof UserPrincipal principal) {
            return principal;
        }
        return null;
    }
}
