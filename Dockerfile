# syntax=docker/dockerfile:1
# ── Stage 1: base image ───────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN apk add --no-cache openssl
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# ── Stage 2: install all dependencies ────────────────────────────────────────
# Copy only manifests first so this layer is cached until deps change.
FROM base AS installer
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json    ./apps/api/
COPY apps/web/package.json    ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/database/package.json ./packages/database/
COPY packages/jobs/package.json     ./packages/jobs/
COPY packages/mailer/package.json   ./packages/mailer/
COPY packages/types/package.json    ./packages/types/
COPY packages/utils/package.json    ./packages/utils/
RUN pnpm install --frozen-lockfile

# ── Stage 3: build ────────────────────────────────────────────────────────────
FROM installer AS builder
WORKDIR /app
COPY . .
# Generate Prisma client for the target platform before compiling TypeScript.
RUN pnpm --filter @pharmacy/database db:generate
# Build packages in dependency order, then the API.
RUN pnpm --filter @pharmacy/types    build
RUN pnpm --filter @pharmacy/utils    build
RUN pnpm --filter @pharmacy/database build
RUN pnpm --filter @pharmacy/mailer   build
RUN pnpm --filter @pharmacy/jobs     build
RUN pnpm --filter @pharmacy/api      build

# ── Stage 4: production deploy bundle ────────────────────────────────────────
# pnpm deploy creates a self-contained folder with only production deps,
# including workspace packages resolved from the local monorepo.
FROM builder AS deployer
WORKDIR /app
RUN pnpm --filter @pharmacy/api deploy --prod /deploy
# Copy the generated Prisma client — it lives outside node_modules and is not
# picked up by pnpm deploy, but is required at runtime.
RUN cp -r node_modules/.prisma /deploy/node_modules/.prisma

# ── Stage 5: minimal production image ────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
# --chown avoids a separate RUN chown layer
COPY --from=deployer --chown=node:node /deploy .
# Run as the built-in unprivileged node user (uid 1000) — never run as root in prod.
USER node
ENV NODE_ENV=production
EXPOSE 4000
# Liveness check: restart container if /health stops responding within 5 s.
# start-period gives the app time to connect to DB before checks begin.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1
CMD ["node", "dist/server.js"]
