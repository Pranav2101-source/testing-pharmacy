#!/usr/bin/env bash
#
# Run the Checkup Pharmacy stack LOCALLY against the PRODUCTION configuration
# taken from the EC2 box (/opt/checkup-pharmacy/.env).
#
#   ./run-local-prod.sh          # fetch env if needed, build if needed, run
#   ./run-local-prod.sh --yes    # skip the confirmation prompt
#
# Ctrl-C stops both processes.

set -euo pipefail

REPO=/Users/saathvikchoudhary/Desktop/checkup-care-pharmacy
PEM="$REPO/Pharmacy_prod.pem"
BOX=ubuntu@15.252.80.194
ENV_FILE="$REPO/.env.prod"
JAR="$REPO/apps/api-java/target/pharmacy-api-0.0.1.jar"
LOGDIR="$REPO/.local-run-logs"
mkdir -p "$LOGDIR"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# ── 0. Confirm ───────────────────────────────────────────────────────────────
if [ "${1:-}" != "--yes" ]; then
  cat <<'WARN'

  !  This runs local code against the LIVE PRODUCTION database.
     Every write (invoices, stock, users) is real customer data, and the
     RESEND_API_KEY is the live key — a password-reset test emails a real
     person. Ctrl-C now if that is not what you want.

WARN
  read -r -p "  Continue? [y/N] " ok
  [ "$ok" = "y" ] || [ "$ok" = "Y" ] || { echo "aborted"; exit 1; }
fi

# ── 1. Prod config ───────────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  say "Fetching prod env from the box"
  chmod 600 "$PEM"
  scp -i "$PEM" -o ConnectTimeout=15 "$BOX:/opt/checkup-pharmacy/.env" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  say "Using existing $ENV_FILE"
fi

set -a; . "$ENV_FILE"; set +a
: "${JDBC_DATABASE_URL:?missing in $ENV_FILE}"
: "${JWT_SECRET:?missing in $ENV_FILE}"

# Local delta: the box's Redis is bound to its own 127.0.0.1, so use ours.
export REDIS_URL="redis://localhost:6379"

# ── 2. Toolchain ─────────────────────────────────────────────────────────────
say "Toolchain"
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
nvm use 20 >/dev/null 2>&1            # Node 25 breaks the web tooling on this machine
command -v pnpm >/dev/null 2>&1 || npm i -g pnpm@9.12.0 >/dev/null 2>&1
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
echo "node $(node -v) | pnpm $(pnpm -v) | java 21"

redis-cli -h 127.0.0.1 ping >/dev/null 2>&1 || {
  say "Starting Redis"; redis-server --daemonize yes --bind 127.0.0.1 --port 6379; sleep 1; }
redis-cli -h 127.0.0.1 ping >/dev/null || { echo "Redis failed to start" >&2; exit 1; }

# ── 3. Build if needed ───────────────────────────────────────────────────────
if [ ! -f "$JAR" ]; then
  say "Building API jar"
  (cd "$REPO/apps/api-java" && ./mvnw -B -q -DskipTests package)
fi
[ -d "$REPO/node_modules" ] || { say "Installing deps"; (cd "$REPO" && pnpm install --frozen-lockfile); }

# ── 4. Run ───────────────────────────────────────────────────────────────────
cleanup() { say "Stopping"; kill "${API_PID:-}" "${WEB_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

say "Starting API on :8080"
# Program args (highest Spring precedence) carry the local-run deltas:
#  - allowed-origins : lets localhost:3000 through CORS *and* the cookie-origin CSRF filter
#  - cookie.secure   : false, because we serve over plain http locally
#  - jobs.enabled    : OFF. ShedLock coordinates via Redis; our Redis is not the box's,
#                      so schedulers (reservation cleanup, EMR dispense retry, stock
#                      alerts) would double-run against the prod DB.
#  - hikari pool 2   : prod runs a pool of 5 and application.yml calls that the hard
#                      ceiling for all tenants combined — a second full pool starves live.
(cd "$REPO/apps/api-java" && java -jar "$JAR" \
    --app.cors.allowed-origins='http://localhost:3000,http://localhost:5173' \
    --app.cookie.secure=false \
    --app.jobs.enabled=false \
    --spring.datasource.hikari.maximum-pool-size=2 \
    --spring.datasource.hikari.minimum-idle=1 \
    > "$LOGDIR/api.log" 2>&1) &
API_PID=$!

printf '    waiting for health'
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/api/v1/health 2>/dev/null || true)
  [ "$code" = "200" ] && { printf ' OK (%ss)\n' "$i"; break; }
  kill -0 "$API_PID" 2>/dev/null || { printf '\n    API died — last lines:\n'; tail -30 "$LOGDIR/api.log"; exit 1; }
  printf '.'; sleep 1
done
[ "${code:-}" = "200" ] || { printf '\n    no health after 60s:\n'; tail -30 "$LOGDIR/api.log"; exit 1; }

say "Starting web on :3000"
(cd "$REPO" && VITE_API_URL=http://localhost:8080/api/v1 \
    pnpm --filter @pharmacy/web dev > "$LOGDIR/web.log" 2>&1) &
WEB_PID=$!
sleep 5

cat <<INFO

  web  http://localhost:3000
  api  http://localhost:8080/api/v1/health
  logs $LOGDIR/{api,web}.log

  Background jobs are DISABLED for this local run (see comment above).
  Ctrl-C to stop both.

INFO

wait
