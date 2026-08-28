#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.e2e.local"
COMPOSE_FILE="$ROOT_DIR/docker-compose.e2e.yml"
API_LOG="$(mktemp /tmp/sugat-e2e-api.XXXXXX.log)"
RESULT_FILE="$(mktemp /tmp/sugat-e2e-result.XXXXXX.json)"
API_PID=""

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

cleanup() {
  local exit_code=$?
  # Starting an already-running Compose service is harmless. Doing this
  # unconditionally guarantees recovery even if the child harness is killed
  # after it stops Redis and before it can report that state to this shell.
  compose start redis >/dev/null 2>&1 || true
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  rm -f "$API_LOG" "$RESULT_FILE"
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

fail() { printf 'PRECHECK: FAIL — %s\n' "$1" >&2; exit 1; }

cd "$ROOT_DIR"
[[ -f "$ENV_FILE" ]] || fail ".env.e2e.local is missing"
[[ -f "$COMPOSE_FILE" ]] || fail "docker-compose.e2e.yml is missing"

docker version >/dev/null || fail "Docker daemon is unavailable"
docker ps >/dev/null || fail "Docker container listing failed"
docker compose version >/dev/null || fail "Docker Compose is unavailable"
compose ps || fail "E2E Compose project is unavailable"

for service in postgres redis; do
  container_id="$(compose ps -q "$service")"
  [[ -n "$container_id" ]] || fail "$service container is not running"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
  [[ "$health" == "healthy" ]] || fail "$service is not healthy (status: $health)"
done

postgres_id="$(compose ps -q postgres)"
redis_id="$(compose ps -q redis)"
docker port "$postgres_id" 5432/tcp | grep -Fx '127.0.0.1:55432' >/dev/null || fail "PostgreSQL is not bound only to 127.0.0.1:55432"
docker port "$redis_id" 6379/tcp | grep -Fx '127.0.0.1:56379' >/dev/null || fail "Redis is not bound only to 127.0.0.1:56379"

for port in 55432 56379; do
  timeout 3 bash -c "</dev/tcp/127.0.0.1/$port" 2>/dev/null || fail "127.0.0.1:$port is unavailable"
done

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

node - <<'NODE'
for (const [key, expectedPort] of [['DATABASE_URL', '55432'], ['REDIS_URL', '56379']]) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is missing`);
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== expectedPort) {
    throw new Error(`${key} must target isolated localhost port ${expectedPort}`);
  }
}
if (process.env.NODE_ENV === 'production') throw new Error('NODE_ENV must not be production');
NODE

corepack pnpm --filter @sugat/api prisma migrate deploy
corepack pnpm --filter @sugat/api prisma db seed
corepack pnpm --filter @sugat/api build

node apps/api/dist/src/main.js >"$API_LOG" 2>&1 &
API_PID=$!
export SUGAT_E2E_API_PID="$API_PID"
export SUGAT_E2E_API_LOG="$API_LOG"
export SUGAT_E2E_RESULT_FILE="$RESULT_FILE"
export SUGAT_E2E_ROOT="$ROOT_DIR"

api_port="${PORT:-3000}"
for _ in $(seq 1 60); do
  if curl --silent --fail "http://127.0.0.1:${api_port}/health" >/dev/null; then break; fi
  kill -0 "$API_PID" 2>/dev/null || { sed -n '1,160p' "$API_LOG" >&2; fail "API exited during startup"; }
  sleep 1
done
curl --silent --fail "http://127.0.0.1:${api_port}/health" >/dev/null || fail "API health check timed out"

set +e
corepack pnpm --filter @sugat/api exec tsx scripts/e2e-final-release-gate.ts
RUNTIME_EXIT=$?
set -e

SOURCE_VALIDATION=PASS
run_validation() {
  printf '\n[validation] %s\n' "$1"
  shift
  "$@" || SOURCE_VALIDATION=FAIL
}
run_validation "API tests" corepack pnpm --filter @sugat/api test
run_validation "API build" corepack pnpm --filter @sugat/api build
run_validation "Prisma validate" corepack pnpm --filter @sugat/api prisma validate
run_validation "Passenger Web build" corepack pnpm --filter @sugat/passenger-web build
run_validation "Admin Web typecheck" corepack pnpm --filter @sugat/admin-web typecheck
run_validation "Admin Web build" corepack pnpm --filter @sugat/admin-web build
run_validation "Driver Mobile typecheck" corepack pnpm --filter @sugat/driver-mobile typecheck
run_validation "Passenger Mobile typecheck" corepack pnpm --filter @sugat/passenger-mobile typecheck
run_validation "Admin Mobile typecheck" corepack pnpm --filter @sugat/admin-mobile typecheck
run_validation "git diff --check" git diff --check

node - "$RESULT_FILE" "$SOURCE_VALIDATION" "$RUNTIME_EXIT" <<'NODE'
const fs = require('fs');
const [file, source, runtimeExit] = process.argv.slice(2);
let r = {};
try { r = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
const gates = [
  ['VALID GPS', 'validGps'], ['GPS QUARANTINE', 'gpsQuarantine'],
  ['PASSENGER REALTIME', 'passengerRealtime'], ['ADMIN REALTIME', 'adminRealtime'],
  ['RECONNECT', 'reconnect'], ['REDIS RUNTIME OUTAGE', 'redisOutage'],
  ['CONCURRENT COMPLETION', 'concurrentCompletion'], ['PASSENGER E2E', 'passengerE2e'],
  ['ADMIN E2E', 'adminE2e'],
];
const allRuntime = runtimeExit === '0' && gates.every(([, key]) => r[key] === 'PASS');
const ready = allRuntime && source === 'PASS';
console.log('\n========================================');
console.log('SUGAT FINAL E2E RELEASE GATE');
console.log('========================================\n');
for (const [label, key] of gates) console.log(`${label}:\n${r[key] || 'FAIL'}\n`);
console.log(`SOURCE VALIDATION:\n${source}\n`);
console.log(`P0 BLOCKERS:\n0\n`);
console.log(`P1 BLOCKERS:\n${ready ? 0 : 1}\n`);
console.log(`PUSH:\n${ready ? 'READY' : 'NOT READY'}\n`);
console.log(`DEPLOYMENT:\n${ready ? 'READY' : 'NOT READY'}`);
process.exit(ready ? 0 : 1);
NODE
