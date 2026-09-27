#!/usr/bin/env bash
set -euo pipefail

binary=${1:?usage: validate-desktop-launch.sh <library-binary>}
log_file=$(mktemp)
pid=""
cleanup() {
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  rm -f "$log_file"
}
trap cleanup EXIT

"$binary" >"$log_file" 2>&1 &
pid=$!

port=""
for _ in $(seq 1 60); do
  if [[ -s "$log_file" ]]; then
    port=$(sed -nE 's#.*http://localhost:([0-9]+).*#\1#p' "$log_file" | head -1)
    [[ -n "$port" ]] && break
  fi
  sleep 0.5
done

if [[ -z "$port" ]]; then
  echo "desktop binary did not announce a server port" >&2
  cat "$log_file" >&2 || true
  exit 1
fi

curl --fail --silent --show-error "http://localhost:$port/api/health" | grep -q '"status":"ok"'
curl --fail --silent --show-error -X POST "http://localhost:$port/api/quit" >/dev/null || true
echo "desktop launch validation passed on port $port"
