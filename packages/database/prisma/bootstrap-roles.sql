-- Idempotent bootstrap for a fresh managed Postgres (Render, RDS, …).
--
-- Migration 20260618000005_prescriptions runs `GRANT … TO app_user`, so the
-- role must exist before `prisma migrate deploy`. On the local test Postgres a
-- docker init script creates it (infra/docker/postgres-init/01-app-user.sql);
-- a managed instance has no init hook, so the API entrypoint runs this first.
--
-- The app itself connects as the database owner (DATABASE_URL), not as app_user,
-- and RLS ships disabled (RLS_ENABLED=false) — here app_user only has to exist so
-- the historical GRANT succeeds. Mirrors the local init script otherwise.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_pass';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Cover every table/sequence future migrations create, without a follow-up GRANT.
-- No "FOR ROLE" — applies to objects created by the current (owner) role, which
-- is the same role that runs the migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
