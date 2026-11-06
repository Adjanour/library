#!/usr/bin/env bash
set -euo pipefail

app=${1:-${LIBRARY_BENCH_APP:-$HOME/.local/bin/library}}
runs=${LIBRARY_BENCH_RUNS:-5}
db_path=${LIBRARY_BENCH_DB_PATH:-}

printf 'run\tserver_announced_ms\thealth_ready_ms\tmodule_http_ms\tdatabase_ms\tservices_ms\tinstance_ms\tbootstrap_ms\tsearch_ms\n'
for run in $(seq 1 "$runs"); do
  log=$(mktemp)
  pid=''
  cleanup() {
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
    rm -f "$log"
  }
  trap cleanup EXIT

  start_ns=$(date +%s%N)
  if [[ -n "$db_path" ]]; then
    LIBRARY_DB_PATH="$db_path" "$app" >"$log" 2>&1 &
  else
    "$app" >"$log" 2>&1 &
  fi
  pid=$!

  port=''
  announced_ns=''
  for _ in $(seq 1 1000); do
    port=$(sed -nE 's#.*http://localhost:([0-9]+).*#\1#p' "$log" | head -1 || true)
    if [[ -n "$port" ]]; then announced_ns=$(date +%s%N); break; fi
    sleep 0.01
  done
  if [[ -z "$port" ]]; then cat "$log" >&2; exit 1; fi

  for _ in $(seq 1 1000); do
    if curl -fsS "http://localhost:$port/api/health" >/dev/null 2>&1; then health_ns=$(date +%s%N); break; fi
    sleep 0.01
  done
  : "${health_ns:?health endpoint did not become ready}"

  bootstrap_s=$(curl -fsS -o /dev/null -w '%{time_total}' "http://localhost:$port/api/bootstrap")
  search_s=$(curl -fsS -o /dev/null -w '%{time_total}' "http://localhost:$port/api/search?limit=60")
  startup=$(curl -fsS "http://localhost:$port/api/diagnostics/startup")
  stage() { jq -r --arg name "$1" '[.stages[] | select(.stage == $name) | .duration_ms][0] // 0' <<<"$startup"; }
  module_http_ms=$(stage module_to_http)
  database_ms=$(stage database)
  services_ms=$(stage services)
  instance_ms=$(stage single_instance)
  curl -fsS -X POST "http://localhost:$port/api/quit" >/dev/null || true
  wait "$pid" 2>/dev/null || true
  pid=''
  trap - EXIT
  rm -f "$log"

  announced_ms=$(( (announced_ns - start_ns) / 1000000 ))
  health_ms=$(( (health_ns - start_ns) / 1000000 ))
  bootstrap_ms=$(awk -v seconds="$bootstrap_s" 'BEGIN { printf "%.2f", seconds * 1000 }')
  search_ms=$(awk -v seconds="$search_s" 'BEGIN { printf "%.2f", seconds * 1000 }')
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$run" "$announced_ms" "$health_ms" "$module_http_ms" "$database_ms" "$services_ms" "$instance_ms" "$bootstrap_ms" "$search_ms"
done
