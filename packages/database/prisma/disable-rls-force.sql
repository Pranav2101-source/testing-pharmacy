-- TEST-ENV ONLY. Runs after `prisma migrate deploy`.
--
-- Migration 20260719000001 sets FORCE ROW LEVEL SECURITY on ~45 tables so the
-- policies bind even the table owner. That is correct for prod, where the app
-- connects as a role that is exempt anyway (Supabase app_user / BYPASSRLS) and
-- FORCE is what stops the *owner* (migrations, psql) seeing across tenants.
--
-- On Render the app connects AS the table owner, and there is no way to grant
-- BYPASSRLS without superuser. With FORCE on and RLS_ENABLED off, every write is
-- denied; with RLS_ENABLED on, pre-auth machine lookups (the EMR HMAC filter's
-- findById) run with no tenant GUC and are filtered to nothing -> 401.
--
-- Dropping FORCE returns the owner to "exempt from its own RLS" — the same
-- effective position the app has in production. The policies themselves stay in
-- place (a non-owner direct connection is still isolated). Idempotent.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;
