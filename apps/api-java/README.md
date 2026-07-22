# Checkup Care Pharmacy — API (Spring Boot)

The backend for Checkup Care Pharmacy: a **Spring Boot 3 / Java 21** service that
serves the React frontend (`apps/web`) over `/api/v1/*` and reads/writes the
Supabase Postgres database (schema owned by Prisma in `packages/database`).

> **Status: foundation only.** Cross-cutting layers (auth, tenancy, error
> handling, response envelope) are in place; the business modules are not built
> yet. Only `/api/v1/health` and `/api/v1/whoami` respond today.

> ⚠️ **Not yet compile-verified.** This was scaffolded on a machine with no JDK
> installed, so it has not been built. Treat the first `mvn` run as the real
> verification step and expect to fix small issues (imports, versions).

## Package layout (package-by-feature)

Cross-cutting layers are separate; every business capability is a self-contained
package under `modules/`.

```
com.checkup.pharmacy
├── CheckupPharmacyApplication      Spring Boot entrypoint
├── config/                         Spring wiring (@Configuration beans)
│   └── SecurityConfig                stateless security, role guards, CORS, 401/403 envelope
├── common/                         shared kernel — used by every module
│   ├── api/ApiResponse               {success,data} / {success,error} response envelope
│   ├── exception/                    AppException hierarchy + GlobalExceptionHandler
│   └── enums/Role                    mirrors the Prisma `Role` enum
├── security/                       authentication mechanism
│   ├── JwtService, JwtPayload         HS256 sign/verify + typed claims
│   ├── JwtAuthenticationFilter        verify → reject refresh → DB `tokenVersion` revocation check
│   └── UserPrincipal                  authenticated principal (carries pharmacyId)
├── tenant/TenantContext            pharmacyId() accessor — MUST scope every query
├── health/                         ops/smoke endpoints (/api/v1/health, /api/v1/whoami)
└── modules/                        ★ one package per business capability
    ├── package-info                  the module convention (read this before adding one)
    └── user/                         User entity + UserRepository (read-model of `users`)
```

Each `modules/<feature>/` package owns its full vertical slice — `Controller`,
`Service`, `Repository`, entity, and a `dto/` sub-package. See
`modules/package-info.java` for the enforced conventions.

## Prerequisites

- **JDK 21** (e.g. Eclipse Temurin) — none is currently installed on this machine.
- **Maven 3.9+** (or run `mvn wrapper:wrapper` once to generate `./mvnw`).

## Configuration (env vars)

| Var | Notes |
|-----|-------|
| `JDBC_DATABASE_URL` | **JDBC** form of the pooler URL. Prefix with `jdbc:`, use the Supabase **pooler** host (`:6543`), and add `prepareThreshold=0` (required for the pgbouncer transaction pooler). |
| `DB_USER`, `DB_PASSWORD` | DB credentials (if not embedded in the URL) |
| `JWT_SECRET` | HS256 secret for signing/verifying tokens (min 32 chars) |
| `ALLOWED_ORIGINS` | Allowed frontend origin(s), comma-separated |
| `REDIS_URL` | Optional until rate-limiting is built |
| `SMTP_*` | Optional until email sending is built |
| `PORT` | Injected by Railway; defaults to 8080 locally |

## Run locally

```bash
# from apps/api-java
export JDBC_DATABASE_URL='jdbc:postgresql://<pooler-host>:6543/postgres?sslmode=require&prepareThreshold=0'
export DB_USER='...'
export DB_PASSWORD='...'
export JWT_SECRET='<a-long-random-secret>'
mvn spring-boot:run
```

Verify:

```bash
# public liveness
curl localhost:8080/api/v1/health

# authenticated — paste a valid access token
curl localhost:8080/api/v1/whoami -H "Authorization: Bearer <accessToken>"
```

## Design rules baked in (do not violate)

1. **Prisma owns the schema.** Hibernate is `ddl-auto: none` and must never
   create/alter/validate tables. Schema changes go through Prisma migrations in
   `packages/database`.
2. **Columns are camelCase, tables snake_case plural.** `globally_quoted_identifiers`
   + `PhysicalNamingStrategyStandardImpl` (in `application.yml`) preserve Prisma's
   exact identifiers. Every `@Column` name is written verbatim.
3. **Every response uses `ApiResponse`.** No raw bodies — the frontend depends on
   the envelope shape.
4. **Every query scopes by `TenantContext.pharmacyId()`.** A missed scope is a
   cross-tenant data leak.
5. **Entities never leave a module as a response.** Map to a `dto/` record so the
   wire contract stays explicit and stable.

## Deploy (Railway)

Railway **service** built from this `Dockerfile`. Set the env vars above. The web
app reaches the API same-origin via `/api/v1` — the Vercel rewrite in
`apps/web/vercel.json` points `/api/*` at this service (rewrites are deployed via
the Vercel CLI, not git).
