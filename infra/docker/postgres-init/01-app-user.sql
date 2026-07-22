-- Runs once, on first boot of the local test Postgres.
--
-- Creates the non-superuser role the API should connect as. This matters more than
-- it looks: Postgres exempts superusers and BYPASSRLS roles from every row-level
-- security policy, so testing RLS while connected as `postgres` shows isolation
-- working when it is not being enforced at all.
--
-- Two roles, deliberately:
--   postgres  — owns the schema, runs Prisma migrations (needs DDL rights)
--   app_user  — what the application connects as, subject to RLS
--
-- An older migration (20260618000005_prescriptions) also GRANTs to app_user, so
-- this role must exist before `prisma migrate deploy` runs or that migration fails.

CREATE ROLE app_user LOGIN PASSWORD 'app_pass';

GRANT USAGE ON SCHEMA public TO app_user;

-- Applies to tables that already exist at this point (none yet — migrations run
-- later), so the DEFAULT PRIVILEGES below are what actually cover the schema.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Anything `postgres` creates from here on is automatically readable/writable by
-- app_user. Without this, every `prisma migrate deploy` would need a follow-up
-- GRANT and the app would fail with "permission denied for table ..." on any new
-- table.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO app_user;
