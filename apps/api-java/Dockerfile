# ─────────────────────────────────────────────────────────────────────────────
# Build context is the REPO ROOT (render.yaml sets `dockerContext: .`) so the
# image can bundle packages/database for the Prisma "migrate deploy" that
# Render runs as a pre-deploy step. Build locally with:
#
#   docker build -f apps/api-java/Dockerfile -t pharmacy-api .
# ─────────────────────────────────────────────────────────────────────────────

# ── Build stage: compile the Spring Boot jar ─────────────────────────────────
FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /app

# Resolve dependencies first so a source-only change reuses this layer.
COPY apps/api-java/pom.xml ./
RUN apk add --no-cache maven && mvn -B -q dependency:go-offline

COPY apps/api-java/src ./src
RUN mvn -B -q clean package -DskipTests

# ── Migrate-deps stage: just the Prisma CLI + schema + migrations ─────────────
# Its own stage/layer: the Java source changes far more often than this does.
FROM node:20-alpine AS migrate-deps
WORKDIR /app/db
COPY packages/database/prisma ./prisma
RUN npm init -y >/dev/null 2>&1 \
 && npm install --no-save --no-audit --no-fund prisma@5.19.0

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# Node (no npm needed) so the entrypoint can run `prisma migrate deploy`
# before the app starts — Render's free plan has no pre-deploy hook.
RUN apk add --no-cache nodejs openssl libstdc++
COPY --from=migrate-deps /app/db /app/db

COPY --from=build /app/target/pharmacy-api-0.0.1.jar app.jar
COPY apps/api-java/derive-jdbc-url.mjs /app/derive-jdbc-url.mjs
COPY apps/api-java/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Render/Railway inject PORT; Spring reads server.port=${PORT:8080}.
EXPOSE 8080
ENTRYPOINT ["/app/docker-entrypoint.sh"]
