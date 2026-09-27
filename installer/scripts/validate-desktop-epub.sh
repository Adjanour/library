#!/usr/bin/env bash
set -euo pipefail

APP=${1:?usage: validate-desktop-epub.sh <app> <db-path> <epub-path> [port]}
DB_PATH=${2:?usage: validate-desktop-epub.sh <app> <db-path> <epub-path> [port]}
EPUB_PATH=${3:?usage: validate-desktop-epub.sh <app> <db-path> <epub-path> [port]}
PORT_HINT=${4:-}

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SEED_JSON=$(deno run --allow-all "$ROOT/deno/scripts/seed-epub-smoke.ts" "$DB_PATH" "$EPUB_PATH")
SMOKE_ID=$(printf '%s' "$SEED_JSON" | sed -n 's/.*"item_id":\([0-9][0-9]*\).*/\1/p')
if [[ -z "$SMOKE_ID" ]]; then
  echo "failed to seed EPUB smoke item: $SEED_JSON" >&2
  exit 1
fi

LOG=$(mktemp)
cleanup() {
  if [[ -n "${APP_PID:-}" ]]; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  rm -f "$LOG"
}
trap cleanup EXIT

LIBRARY_DB_PATH="$DB_PATH" \
LIBRARY_EPUB_SMOKE_ID="$SMOKE_ID" \
LIBRARY_PORT="$PORT_HINT" \
"$APP" ${PORT_HINT:+"$PORT_HINT"} >"$LOG" 2>&1 &
APP_PID=$!

PORT=""
for _ in $(seq 1 120); do
  if [[ -s "$LOG" ]]; then
    PORT=$(sed -nE 's#.*http://localhost:([0-9]+).*#\1#p' "$LOG" | head -1)
  fi
  if [[ -n "$PORT" ]] && curl -fsS "http://localhost:$PORT/api/health" >/dev/null; then break; fi
  sleep 0.25
done
if [[ -z "$PORT" ]]; then
  echo "desktop binary did not announce a server port" >&2
  cat "$LOG" >&2 || true
  exit 1
fi
curl -fsS "http://localhost:$PORT/api/health" >/dev/null

for _ in $(seq 1 120); do
  diagnostics=$(curl -fsS "http://localhost:$PORT/api/diagnostics/epub" || true)
  if printf '%s' "$diagnostics" | grep -q '"event":"rendition-attempt"' && \
    printf '%s' "$diagnostics" | grep -q '"phase":"success"'; then
    echo "desktop EPUB smoke validation passed"
    exit 0
  fi
  if printf '%s' "$diagnostics" | grep -q '"event":"failure"'; then
    echo "$diagnostics" >&2
    cat "$LOG" >&2 || true
    exit 1
  fi
  sleep 0.25
done

echo "timed out waiting for packaged EPUB rendition" >&2
curl -fsS "http://localhost:$PORT/api/diagnostics/epub" >&2 || true
cat "$LOG" >&2 || true
exit 1
