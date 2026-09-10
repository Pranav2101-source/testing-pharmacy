#!/bin/sh
# Apply pending Prisma migrations, then start the API.
#
# Render's free plan has no pre-deploy hook, so migrations run here on every
# container start. `prisma migrate deploy` is idempotent — a no-op (~2 s) when
# the database is already current — and takes a Postgres advisory lock, so a
# restart storm can't run two at once.
set -e

if [ -n "${DATABASE_URL:-}" ] && [ -d /app/db/prisma/migrations ]; then
  echo "[entrypoint] prisma migrate deploy…"
  cd /app/db
  node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma
  cd /app
else
  echo "[entrypoint] no DATABASE_URL / migrations dir — skipping migrate deploy"
fi

exec java -jar /app/app.jar
