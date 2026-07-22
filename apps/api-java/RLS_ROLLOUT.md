# Row-Level Security rollout

Database-enforced tenant isolation. Everything is built and shipped **off**; this
is the sequence to turn it on safely.

Verified end-to-end against a real Postgres 16 (Docker, full Prisma migration set):
unscoped queries return 0 rows, a tenant sees only its own rows, cross-tenant reads
by primary key return 404 through the API, and writing a row stamped with another
tenant's id is rejected by the database.

---

## Two findings from that verification — read these first

### 1. Your schema already had RLS, and it failed open

Migration `20260618000002_row_level_security` created policies named
`<table>_tenant_isolation` on 44 tables. They key off `app.current_pharmacy_id`,
which **nothing in the Java backend ever sets**, and their condition is:

```sql
current_setting('app.current_pharmacy_id', true) IS NULL   -- → TRUE, all rows visible
OR current_setting('app.current_pharmacy_id', true) = ''   -- → TRUE, all rows visible
OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
```

Absent GUC means *grant everything*. So that layer has been inert since the Java
rewrite. Worse, Postgres OR-combines permissive policies, so leaving it in place
would have silently neutralised the new fail-closed policy — RLS that looks
deployed and enforces nothing. Confirmed empirically: with both policy sets live
and scope set to pharmacy A, `SELECT * FROM customers` still returned pharmacy B's
rows.

The new migration drops those superseded policies on every table it manages.

### 2. The app must NOT connect as a superuser or `BYPASSRLS` role

Postgres exempts superusers and `BYPASSRLS` roles from **every** policy,
unconditionally. `FORCE ROW LEVEL SECURITY` does not change this — it only subjects
the table *owner*.

This is not theoretical: during verification, the identical query returned
2 rows as `postgres` (superuser) and 1 row as `app_user`. **Check which role the
deployed API's `JDBC_DATABASE_URL` uses against Supabase** — if it is the default
`postgres`, RLS will do nothing. (Confirmed on this project's database: the
default role reports `rolbypassrls = true`.)

```sql
CREATE ROLE app_user LOGIN PASSWORD '<secret>';
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
```

`RlsRoleValidator` now refuses to start when RLS is on and the role can bypass it,
so this cannot be shipped unnoticed. Override with
`app.rls.fail-on-bypass-role=false` only for local work.

## Why the order matters

There are two switches and they are **not** symmetric:

| State | Effect |
|---|---|
| Migration applied, `RLS_ENABLED=false` | **Outage.** Policies are live, nothing sets `app.pharmacy_id`, every query fails closed. The app returns empty data everywhere — bills show no items, inventory looks empty. |
| `RLS_ENABLED=true`, migration not applied | Harmless. The GUCs are set on each transaction and no policy reads them. |

So: **enable the flag first, apply the migration second.** The reverse order is
the one that takes the shop down mid-sale.

> Postgres RLS is skipped for a table's **owner** unless `FORCE ROW LEVEL SECURITY`
> is set. The app connects to Supabase as the owner, so the migration sets FORCE on
> every table. Without it the policies would exist and do nothing — RLS that looks
> deployed but isn't.

## Steps

### 0. Confirm the database role first

```sql
SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
```

Both booleans must be `f`. If not, create `app_user` as above and repoint
`DB_USER` / `DB_PASSWORD` **before** going further — otherwise every step below
will appear to succeed while enforcing nothing.

### 1. Staging first — do not skip

```bash
# a) turn the flag on in the staging API, redeploy, confirm it still works normally
RLS_ENABLED=true

# b) apply the policies
psql "$STAGING_DATABASE_URL" -f packages/database/prisma/migrations/20260719000001_row_level_security/migration.sql
```

### 2. Exercise the real flows on staging

Sales are the highest risk: a fail-closed query there is silent and looks like
missing stock rather than an error.

- [ ] Log in, log out, refresh a token, run the forgot-password flow
- [ ] Create a bill with several batches; confirm stock decrements
- [ ] Sales return, invoice cancel, add payment
- [ ] Purchase order → GRN → confirm; check stock increments
- [ ] Reports: GST summary, HSN, Schedule H, expiry, valuation
- [ ] Stock audit: create session, count, approve
- [ ] Support: create ticket, attach a file, download it
- [ ] Platform admin console (this uses the `PLATFORM_ADMIN` bypass — verify it still sees all tenants)
- [ ] Wait for the 5-minute reservation cleanup job and confirm it logs a sweep

### 3. Verify isolation actually holds

With two pharmacies in staging, log in as pharmacy A and request one of
pharmacy B's records by id (an invoice, a customer). Expect **404**, not data.

Direct check in `psql`:

```sql
-- No tenant set: must return 0 rows.
SELECT count(*) FROM invoices;

-- Scoped to one tenant: must return only that tenant's rows.
SELECT set_config('app.pharmacy_id', '<a-real-pharmacy-id>', false);
SELECT count(*) FROM invoices;
```

If the first query returns rows, the policy is not being enforced — check that
`FORCE ROW LEVEL SECURITY` applied and that you are not connected as a superuser
or a `BYPASSRLS` role.

### 4. Production

Same order: set `RLS_ENABLED=true` on the API host and let it redeploy, confirm the app
is healthy, then apply the migration to Supabase. Do it during a quiet hour — for a
pharmacy that means late evening, not "off-peak" in UTC terms.

## Rollback

Fastest first:

1. **Set `RLS_ENABLED=false`.** If it is an env var this needs no deploy. The app
   stops setting the GUCs — but note the policies are still live, so this alone
   leaves queries failing closed. Use it only together with step 2.
2. **Drop the policies:**
   ```bash
   psql "$DATABASE_URL" -f packages/database/prisma/migrations/20260719000001_row_level_security/down.sql
   ```
   This is the real rollback and returns the database to convention-only isolation.

## What still relies on discipline

RLS is bypassed for `PLATFORM_ADMIN` and for anything marked `@CrossTenant`.
Those call sites are the remaining trust boundary — grep for them in review:

```bash
grep -rn "@CrossTenant" apps/api-java/src/main/java
```

Each carries a mandatory reason string. Adding one is a security-relevant change.
