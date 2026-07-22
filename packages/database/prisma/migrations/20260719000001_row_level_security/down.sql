-- Rollback for 20260719000001_row_level_security.
--
-- Run this if RLS causes a production incident. It drops the policies and
-- disables enforcement, returning the database to convention-only isolation
-- (i.e. the behaviour before that migration). The app keeps working either way:
-- with app.rls.enabled=false it never sets the GUCs at all.
--
-- Apply with:  psql "$DATABASE_URL" -f down.sql

DO $rls_down$
DECLARE
    t text;
BEGIN
    FOR t IN
        SELECT c.relname
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND p.polname = 'tenant_isolation'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
        EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    END LOOP;
END
$rls_down$;
