#!/bin/sh
# Prepare the environment, apply pending Prisma migrations, then start the API.
#
# Render's free plan has no pre-deploy hook, so migrations run here on every
# container start. `prisma migrate deploy` is idempotent — a no-op (~2 s) when
# the database is already current — and takes a Postgres advisory lock, so a
# restart storm can't run two at once.
set -e

# Spring needs a jdbc: URL; the platform gives us a postgresql:// one.
if [ -n "${DATABASE_URL:-}" ] && [ -z "${JDBC_DATABASE_URL:-}" ]; then
  eval "$(node /app/derive-jdbc-url.mjs)"
  echo "[entrypoint] derived JDBC_DATABASE_URL for host $(echo "$JDBC_DATABASE_URL" | sed -E 's#.*//([^:/?]+).*#\1#')"
fi

if [ -n "${DATABASE_URL:-}" ] && [ -d /app/db/prisma/migrations ]; then
  cd /app/db
  # The schema's GRANTs need an app_user role; a managed Postgres has no init
  # hook to create it (see prisma/bootstrap-roles.sql). Idempotent.
  echo "[entrypoint] ensuring app_user role…"
  node_modules/.bin/prisma db execute --schema prisma/schema.prisma --file prisma/bootstrap-roles.sql
  echo "[entrypoint] prisma migrate deploy…"
  node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma
  # Test env: the app connects as the table owner, so drop FORCE RLS (see
  # prisma/disable-rls-force.sql) — otherwise the owner is bound by its own
  # fail-closed policies and every write / pre-auth lookup is denied.
  echo "[entrypoint] relaxing FORCE row-level security (test env)…"
  node_modules/.bin/prisma db execute --schema prisma/schema.prisma --file prisma/disable-rls-force.sql
  cd /app
else
  echo "[entrypoint] no DATABASE_URL / migrations dir — skipping DB setup"
fi

exec java -jar /app/app.jar
