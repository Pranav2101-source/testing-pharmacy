-- Creates the database role the API should connect as, so Row-Level Security is
-- actually enforced.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS IS REQUIRED
--
-- Supabase's default `postgres` role has BYPASSRLS:
--
--   SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
--   →  postgres | false | TRUE
--
-- Postgres exempts BYPASSRLS roles from EVERY row-level security policy,
-- unconditionally and with no warning. `FORCE ROW LEVEL SECURITY` does not help —
-- it only subjects a table's *owner*, not a bypassing role.
--
-- Verified against Postgres 16 with the real policies installed: connected as a
-- BYPASSRLS role and scoped to a pharmacy id that does not exist, a plain
-- `SELECT count(*) FROM customers` still returned rows. Deploying RLS while the
-- application connects as `postgres` therefore produces security that looks
-- present in every audit and enforces nothing.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- HOW TO RUN
--
--   1. Supabase dashboard → SQL Editor (runs as `postgres`).
--   2. Replace CHANGE_ME_STRONG_PASSWORD below with a real secret.
--      Do NOT commit the filled-in version.
--   3. Run it.
--   4. Point the API's DB_USER / DB_PASSWORD at this role (see the note on the
--      pooler username format at the bottom — it is not just "app_user").
--
-- Migrations keep running as `postgres`: `app_user` deliberately has no DDL
-- rights, so it cannot create or drop tables even if the API were compromised.

-- ── 1. The role ──────────────────────────────────────────────────────────────
-- NOBYPASSRLS and NOSUPERUSER are stated explicitly rather than relying on
-- defaults — they are the entire point of this role, and an explicit declaration
-- survives someone later copying this file as a template.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD'
            NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    ELSE
        -- Idempotent: make an existing role conform, in case it was created by hand.
        ALTER ROLE app_user NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        RAISE NOTICE 'app_user already existed — attributes corrected, password left unchanged.';
    END IF;
END
$$;

-- ── 2. Access to what exists today ───────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO app_user;

-- DML only. No TRUNCATE (bypasses RLS by design), no REFERENCES, no TRIGGER,
-- and no DDL — the application never needs them, and withholding them limits the
-- blast radius of a SQL-injection bug to row-level damage the policies still bound.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- ── 3. Access to what future migrations create ───────────────────────────────
-- Without this, the next Prisma migration that adds a table would leave the API
-- failing with "permission denied for table ..." — at deploy time, in production,
-- on a table that looks perfectly fine in the dashboard.
--
-- FOR ROLE postgres because that is the role that runs migrations and will own
-- the new objects. Default privileges are keyed to the CREATING role, so naming
-- the wrong one here silently does nothing.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- ── 4. Confirm ───────────────────────────────────────────────────────────────
-- Both booleans MUST come back false. If rolbypassrls is true, stop: RLS will not
-- be enforced and the API will refuse to start (see RlsRoleValidator).
SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname = 'app_user';

-- ─────────────────────────────────────────────────────────────────────────────
-- CONNECTION STRING NOTE — the part that catches people out
--
-- Through Supabase's connection pooler (port 6543), the username carries the
-- project reference as a suffix. It is NOT just the role name:
--
--   DB_USER = app_user.<your-project-ref>       ← note the dot and project ref
--   DB_USER = app_user                          ← will fail to authenticate
--
-- Mirroring the existing `postgres.<project-ref>` you already use. Test the
-- connection before rolling this into the deploy; if the pooler rejects the custom
-- role, connect on port 5432 (session mode, direct) instead and size the Hikari
-- pool down accordingly.
--
-- Keep prepareThreshold=0 on the 6543 URL — DatasourceConfigValidator enforces it.
