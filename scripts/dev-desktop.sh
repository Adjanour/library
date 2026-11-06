#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
vite_pid=""

cleanup() {
  if [[ -n "$vite_pid" ]]; then kill "$vite_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

pnpm --dir "$root/web/svelte" run dev -- --host 127.0.0.1 --port 5173 --strictPort &
vite_pid=$!

for _ in {1..50}; do
  if curl --silent --fail http://127.0.0.1:5173/ >/dev/null; then break; fi
  sleep 0.1
done
curl --silent --fail http://127.0.0.1:5173/ >/dev/null

cd "$root/deno"
LIBRARY_WEB_DEV_URL=http://127.0.0.1:5173 deno desktop --hmr --allow-all --include ../web/static src/main.ts
