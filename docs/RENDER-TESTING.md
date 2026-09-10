# Deploying the testing environment to Render

A throwaway staging copy of the pharmacy stack, driven by
[`render.yaml`](../render.yaml) at the repo root. Push to
`Pranav2101-source/testing-pharmacy`, deploy, poke at it, and once it looks
right, merge the same code into `Checkup-Care/checkup-care-pharmacy`.

## What gets created

| Service | Type | Plan | URL |
|---|---|---|---|
| `pharmacy-test-db` | Postgres 16 | free | internal |
| `pharmacy-test-redis` | Key Value (Redis) | free | internal |
| `pharmacy-test-api` | Spring Boot API (Docker) | free | `pharmacy-test-api.onrender.com` |
| `pharmacy-test-web` | Vite SPA (static) | free | `pharmacy-test-web.onrender.com` |

The SPA calls `/api/v1/...` same-origin; Render rewrites `/api/*` to the API
service server-side, so the httpOnly refresh cookie stays first-party.

## One-time setup

1. **Push the code** (already done if a `main` branch exists on the testing repo):
   ```bash
   git remote add testing https://github.com/Pranav2101-source/testing-pharmacy.git
   git push testing HEAD:main
   ```

2. **Create the Blueprint**
   - <https://dashboard.render.com> → **New** → **Blueprint**
   - Connect the `Pranav2101-source/testing-pharmacy` repo (authorise Render on
     GitHub if prompted). It auto-detects `render.yaml`.
   - Click **Apply**. Render creates all four services + the database.

3. **Fill the secrets** Render left blank (each service → **Environment**).
   On `pharmacy-test-api`:

   | Key | Value |
   |---|---|
   | `SUPABASE_URL` | from the LIVE Supabase project → Settings → API |
   | `SUPABASE_SERVICE_ROLE_KEY` | LIVE project service-role key (secret) |
   | `SUPABASE_STORAGE_BUCKET` | `pharmacy-docs` |
   | `RESEND_API_KEY` *(optional)* | live/test Resend key, or leave blank |
   | `EMAIL_FROM` *(optional)* | e.g. `noreply@checkup.care` |
   | `EMAIL_FROM_NAME` *(optional)* | `Checkup Pharmacy (test)` |
   | `EMR_CONNECTION_ENCRYPTION_KEY` *(optional)* | `openssl rand -hex 32` |

   Save → Render redeploys the API.

4. **Check the real URLs.** If Render appended a suffix to either service name
   (because the name was taken), edit `render.yaml`:
   - `pharmacy-test-web` → `routes[0].destination` → the actual API URL
   - `pharmacy-test-api` → `ALLOWED_ORIGINS`, `APP_URL`, `EMR_PHARMACY_BASE_URL`
     → the actual web URL

   Commit, push to `testing`, then **Manual Sync** on the Blueprint.

## Migrations

Handled automatically. The API image bundles the Prisma CLI + `packages/database`,
and `apps/api-java/docker-entrypoint.sh` runs `prisma migrate deploy` against
`pharmacy-test-db` on every container start, before the JVM boots. It's
idempotent (a ~2 s no-op when the DB is already current) and takes a Postgres
advisory lock. Add a migration, push, done.

> Why the entrypoint and not Render's pre-deploy hook: the pre-deploy hook is a
> paid-plan feature. Move to it (`preDeployCommand:` in `render.yaml`) if you
> upgrade the API service off free.

> If a deploy's logs show the migrate step failing (DB unreachable, bad
> migration), the container crash-loops until it's fixed — check the API service
> logs.

## Seeding test data

The DB starts empty. Either register a pharmacy through the UI, or run the seed
script from your machine against the DB's **External** connection string
(dashboard → `pharmacy-test-db` → *Connections*):

```bash
cd packages/database
DATABASE_URL="<external-url>" DIRECT_URL="<external-url>" pnpm db:seed
```

## Free-tier reality check

- **Postgres is deleted 30 days after creation.** Upgrade it (~$6/mo) or plan to
  recreate + re-seed. Migrations re-run on the next deploy automatically.
- **Web services sleep after 15 min idle** → first hit is a ~50 s cold start
  (Docker + JVM). Normal.
- **Redis has no persistence** — rate-limit counters reset on restart.
- **First deploy of the API takes ~5–8 min** (multi-stage Maven + JVM + Prisma
  build). Subsequent deploys reuse cached layers.

## Promoting to production

Nothing here is prod-specific except the service names and free plans. When the
testing branch is approved, merge it into the main Checkup-Care repo as usual —
`render.yaml` and the Dockerfile changes ride along and are harmless there unless
you point a Render Blueprint at that repo too.
