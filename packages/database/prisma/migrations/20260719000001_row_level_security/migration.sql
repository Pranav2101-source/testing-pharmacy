-- Row-Level Security: enforce tenant isolation in the DATABASE, not by convention.
--
-- Until now isolation depended on every service remembering to add `pharmacyId`
-- to every query (see TenantContext's javadoc). That is one forgotten WHERE
-- clause away from a cross-tenant data leak, and nothing in the build catches it.
-- These policies make the database itself refuse to return or write another
-- tenant's rows, so a missing WHERE clause becomes "zero rows" instead of
-- "someone else's data".
--
-- HOW IT WORKS
--   The app sets two transaction-local GUCs at the start of every transaction
--   (see RlsTenantTransactionManager):
--     app.pharmacy_id  -- the caller's tenant
--     app.bypass_rls   -- 'on' only for platform-admin + explicit system work
--   Both are set with set_config(..., is_local => true), so they are scoped to
--   the transaction and reset on commit/rollback. That is what makes this safe
--   behind Supabase's TRANSACTION-mode pooler (port 6543): a transaction is
--   pinned to one backend, and nothing leaks into the next borrower of that
--   connection.
--
--   If neither GUC is set, current_setting(..., true) returns NULL, the policy
--   evaluates to NULL -> false, and the table returns nothing. This FAILS CLOSED
--   on purpose: a bug that loses tenant context yields an empty result, never
--   another pharmacy's data.
--
-- WHY "FORCE"
--   The app connects to Supabase as the role that OWNS these tables, and a table
--   owner is exempt from its own RLS policies unless FORCE is set. Without the
--   FORCE line below, every policy here would be silently inert in production —
--   the single easiest way to deploy RLS that does nothing.
--
-- REPLACES A FAIL-OPEN POLICY SET (this is the important part)
--   Migration 20260618000002_row_level_security already created policies named
--   "<table>_tenant_isolation" on 44 tables. They key off a DIFFERENT GUC
--   (app.current_pharmacy_id, which no code in the Java backend ever sets) and,
--   critically, they FAIL OPEN:
--
--     current_setting('app.current_pharmacy_id', true) IS NULL  -> TRUE (all rows)
--
--   So they grant unrestricted access whenever the GUC is absent, which is always.
--   That alone is only useless. What makes it actively dangerous is that Postgres
--   combines multiple PERMISSIVE policies with OR: leaving them in place would
--   make the fail-closed policy below unreachable, and tenant isolation would
--   appear to be deployed while granting every tenant access to every row.
--   Verified against a real Postgres 16 before writing this: with both policy sets
--   installed and app.pharmacy_id scoped to pharmacy A, "SELECT * FROM customers"
--   still returned pharmacy B's rows.
--
--   Each old policy is therefore dropped on the tables handled here.
--
--   Five tables also carry an old policy but are deliberately NOT touched:
--   invoice_settings, purchase_order_items, supplier_payments,
--   supplier_credit_notes, supplier_return_items. They are dead leftovers from the
--   Node-era table reductions — absent from schema.prisma, zero rows, and
--   referenced by no Java code. Dropping their policy while RLS stayed FORCEd
--   would make them deny-all for no benefit.
--
-- ROLLBACK: see down.sql in this directory.

DO $rls$
DECLARE
    t text;
    -- Every table carrying a pharmacyId column, derived from schema.prisma.
    -- Tables NOT listed here are deliberately global (shared medicine catalog,
    -- pharmacies, product_categories, brands, support_agents, ticket_categories,
    -- ticket_sequences, subscription_audit_logs, migration_created_records).
    tenant_tables text[] := ARRAY[
        'audit_logs',
        'batch_recalls',
        'calendar_events',
        'cash_closures',
        'customers',
        'doctors',
        'document_sequences',
        'goods_receipt_notes',
        'grn_items',
        'inventory',
        'inventory_movements',
        'invoice_items',
        'invoice_payments',
        'invoices',
        'medicine_mappings',
        'migration_import_jobs',
        'migration_sessions',
        'notification_logs',
        'pharmacy_medicine_overrides',
        'prescription_items',
        'prescriptions',
        'purchase_orders',
        'quotation_items',
        'quotations',
        'racks',
        'sales_return_items',
        'sales_returns',
        'shelves',
        'stock_audit_items',
        'stock_audit_sessions',
        'stock_reservations',
        'subscription_invoices',
        'subscriptions',
        'supplier_ledger_entries',
        'supplier_returns',
        'suppliers',
        'support_tickets',
        'tenant_settings',
        'ticket_attachments',
        'ticket_messages',
        'uploads',
        'users'
    ];
BEGIN
    FOREACH t IN ARRAY tenant_tables LOOP
        -- Guard: fail loudly if the schema drifts, rather than silently skipping
        -- a table and leaving it unprotected.
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = t
        ) THEN
            RAISE EXCEPTION 'RLS migration: expected table public.% not found', t;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = t AND column_name = 'pharmacyId'
        ) THEN
            RAISE EXCEPTION 'RLS migration: table public.% has no "pharmacyId" column', t;
        END IF;

        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
        -- Remove the superseded fail-open policy from 20260618000002. Without this
        -- the OR-combination below never restricts anything (see header note).
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_isolation', t);

        -- USING governs what SELECT/UPDATE/DELETE can SEE.
        -- WITH CHECK governs what INSERT/UPDATE may WRITE — without it a tenant
        -- could insert rows stamped with someone else's pharmacyId.
        EXECUTE format($policy$
            CREATE POLICY tenant_isolation ON public.%I
                USING (
                    current_setting('app.bypass_rls', true) = 'on'
                    OR "pharmacyId" = current_setting('app.pharmacy_id', true)
                )
                WITH CHECK (
                    current_setting('app.bypass_rls', true) = 'on'
                    OR "pharmacyId" = current_setting('app.pharmacy_id', true)
                )
        $policy$, t);
    END LOOP;

    -- The tenant root itself. Scoped on "id" rather than "pharmacyId" — a pharmacy
    -- may see its own row and no other. Registration (which creates the row before
    -- any tenant exists), the background sweeps, and the platform-admin console all
    -- reach this through the bypass, so scoping it does not break them.
    EXECUTE 'ALTER TABLE public.pharmacies ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.pharmacies FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.pharmacies';
    EXECUTE 'DROP POLICY IF EXISTS pharmacies_tenant_isolation ON public.pharmacies';
    EXECUTE $pharm$
        CREATE POLICY tenant_isolation ON public.pharmacies
            USING (
                current_setting('app.bypass_rls', true) = 'on'
                OR id = current_setting('app.pharmacy_id', true)
            )
            WITH CHECK (
                current_setting('app.bypass_rls', true) = 'on'
                OR id = current_setting('app.pharmacy_id', true)
            )
    $pharm$;
END
$rls$;
